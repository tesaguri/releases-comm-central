/* -*- Mode: C++; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#include "nsAbManager.h"
#include "nsAbBaseCID.h"
#include "nsAddrDatabase.h"
#include "nsIOutputStream.h"
#include "nsNetUtil.h"
#include "nsNativeCharsetUtils.h"
#include "nsIStringBundle.h"
#include "nsMsgUtils.h"
#include "nsAppDirectoryServiceDefs.h"
#include "plstr.h"
#include "prmem.h"
#include "mozIDOMWindow.h"
#include "plbase64.h"
#include "nsIWindowWatcher.h"
#include "nsDirectoryServiceUtils.h"
#include "nsVCard.h"
#include "nsVCardObj.h"
#include "nsIAbLDAPAttributeMap.h"
#include "nsICommandLine.h"
#include "nsIFile.h"
#include "nsIMutableArray.h"
#include "nsArrayUtils.h"
#include "nsDirectoryServiceUtils.h"
#include "nsIObserverService.h"
#include "nsDirPrefs.h"
#include "nsThreadUtils.h"
#include "nsComponentManagerUtils.h"
#include "nsAbQueryStringToExpression.h"
#include "mozilla/ArrayUtils.h"
#include "mozilla/Services.h"
using namespace mozilla;

struct ExportAttributesTableStruct {
  const char *abPropertyName;
  uint32_t plainTextStringID;
};

// our schema is not fixed yet, but we still want some sort of objectclass
// for now, use obsolete in the class name, hinting that this will change
// see bugs bug #116692 and #118454
#define MOZ_AB_OBJECTCLASS "mozillaAbPersonAlpha"

// for now, the order of the attributes with true for includeForPlainText
// should be in the same order as they are in the import code
// see importMsgProperties and nsImportStringBundle.
//
// XXX todo, merge with what's in nsAbLDAPProperties.cpp, so we can
// use this for LDAP and LDIF export
//
// here's how we're coming up with the ldapPropertyName values
// if they are specified in RFC 2798, use them
// else use the 4.x LDIF attribute names (for example, "xmozillanickname"
// as we want to allow export from mozilla back to 4.x, and other apps
// are probably out there that can handle 4.x LDIF)
// else use the MOZ_AB_LDIF_PREFIX prefix, see nsIAddrDatabase.idl

const ExportAttributesTableStruct EXPORT_ATTRIBUTES_TABLE[] = {
    {kFirstNameProperty, 2100},     {kLastNameProperty, 2101},
    {kDisplayNameProperty, 2102},   {kNicknameProperty, 2103},
    {kPriEmailProperty, 2104},      {k2ndEmailProperty, 2105},
    {kScreenNameProperty, 2136},    {kPreferMailFormatProperty, 0},
    {kLastModifiedDateProperty, 0}, {kWorkPhoneProperty, 2106},
    {kWorkPhoneTypeProperty, 0},    {kHomePhoneProperty, 2107},
    {kHomePhoneTypeProperty, 0},    {kFaxProperty, 2108},
    {kFaxTypeProperty, 0},          {kPagerProperty, 2109},
    {kPagerTypeProperty, 0},        {kCellularProperty, 2110},
    {kCellularTypeProperty, 0},     {kHomeAddressProperty, 2111},
    {kHomeAddress2Property, 2112},  {kHomeCityProperty, 2113},
    {kHomeStateProperty, 2114},     {kHomeZipCodeProperty, 2115},
    {kHomeCountryProperty, 2116},   {kWorkAddressProperty, 2117},
    {kWorkAddress2Property, 2118},  {kWorkCityProperty, 2119},
    {kWorkStateProperty, 2120},     {kWorkZipCodeProperty, 2121},
    {kWorkCountryProperty, 2122},   {kJobTitleProperty, 2123},
    {kDepartmentProperty, 2124},    {kCompanyProperty, 2125},
    {kWorkWebPageProperty, 2126},   {kHomeWebPageProperty, 2127},
    {kBirthYearProperty, 2128},   // unused for now
    {kBirthMonthProperty, 2129},  // unused for now
    {kBirthDayProperty, 2130},    // unused for now
    {kCustom1Property, 2131},       {kCustom2Property, 2132},
    {kCustom3Property, 2133},       {kCustom4Property, 2134},
    {kNotesProperty, 2135},         {kAnniversaryYearProperty, 0},
    {kAnniversaryMonthProperty, 0}, {kAnniversaryDayProperty, 0},
    {kSpouseNameProperty, 0},       {kFamilyNameProperty, 0},
};

//
// nsAbManager
//
nsAbManager::nsAbManager() {}

nsAbManager::~nsAbManager() {}

NS_IMPL_ISUPPORTS(nsAbManager, nsIAbManager, nsICommandLineHandler, nsIObserver)

nsresult nsAbManager::Init() {
  NS_ENSURE_TRUE(NS_IsMainThread(), NS_ERROR_FAILURE);

  nsCOMPtr<nsIObserverService> observerService =
      mozilla::services::GetObserverService();
  NS_ENSURE_TRUE(observerService, NS_ERROR_UNEXPECTED);

  nsresult rv = observerService->AddObserver(this, "profile-do-change", false);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = observerService->AddObserver(this, "addrbook-reload", false);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = observerService->AddObserver(this, NS_XPCOM_SHUTDOWN_OBSERVER_ID, false);
  NS_ENSURE_SUCCESS(rv, rv);

  return NS_OK;
}

NS_IMETHODIMP nsAbManager::Observe(nsISupports *aSubject, const char *aTopic,
                                   const char16_t *someData) {
  // The nsDirPrefs code caches all the directories that it got
  // from the first profiles prefs.js.
  // When we profile switch, we need to force it to shut down.
  // We'll re-load all the directories from the second profiles prefs.js
  // that happens in nsAbBSDirectory::GetChildNodes()
  // when we call DIR_GetDirectories().
  if (!strcmp(aTopic, "profile-do-change")) {
    DIR_ShutDown();
    return NS_OK;
  }

  if (!strcmp(aTopic, "addrbook-reload")) {
    DIR_ShutDown();
    mCacheTopLevelAb = nullptr;
    mAbStore.Clear();
    return NS_OK;
  }

  if (!strcmp(aTopic, NS_XPCOM_SHUTDOWN_OBSERVER_ID)) {
    DIR_ShutDown();

    nsCOMPtr<nsIObserverService> observerService =
        mozilla::services::GetObserverService();
    NS_ENSURE_TRUE(observerService, NS_ERROR_UNEXPECTED);

    nsresult rv = observerService->RemoveObserver(this, "profile-do-change");
    NS_ENSURE_SUCCESS(rv, rv);

    rv = observerService->RemoveObserver(this, "addrbook-reload");
    NS_ENSURE_SUCCESS(rv, rv);

    rv = observerService->RemoveObserver(this, NS_XPCOM_SHUTDOWN_OBSERVER_ID);
    NS_ENSURE_SUCCESS(rv, rv);
  }

  return NS_OK;
}

//
// nsIAbManager
//

NS_IMETHODIMP nsAbManager::GetDirectories(nsISimpleEnumerator **aResult) {
  NS_ENSURE_ARG_POINTER(aResult);

  // We cache the top level AB to ensure that nsIAbDirectory items are not
  // created and dumped every time GetDirectories is called. This was causing
  // performance problems, especially with the content policy on messages
  // with lots of urls.
  nsresult rv;
  nsCOMPtr<nsIAbDirectory> rootAddressBook;
  rv = GetRootDirectory(getter_AddRefs(rootAddressBook));
  NS_ENSURE_SUCCESS(rv, rv);

  return rootAddressBook->GetChildNodes(aResult);
}

nsresult nsAbManager::GetRootDirectory(nsIAbDirectory **aResult) {
  // We cache the top level AB to ensure that nsIAbDirectory items are not
  // created and dumped every time GetDirectories is called. This was causing
  // performance problems, especially with the content policy on messages
  // with lots of urls.
  nsresult rv;

  if (!mCacheTopLevelAb) {
    nsCOMPtr<nsIAbDirectory> rootAddressBook(
        do_GetService(NS_ABDIRECTORY_CONTRACTID, &rv));
    NS_ENSURE_SUCCESS(rv, rv);
    mCacheTopLevelAb = rootAddressBook;
  }

  NS_IF_ADDREF(*aResult = mCacheTopLevelAb);
  return NS_OK;
}

NS_IMETHODIMP nsAbManager::GetDirectoryFromId(const nsACString &aDirPrefId,
                                              nsIAbDirectory **aResult) {
  NS_ENSURE_ARG_POINTER(aResult);

  nsCOMPtr<nsISimpleEnumerator> enumerator;
  nsresult rv = GetDirectories(getter_AddRefs(enumerator));
  NS_ENSURE_SUCCESS(rv, rv);
  nsCOMPtr<nsISupports> support;
  nsCOMPtr<nsIAbDirectory> directory;

  bool hasMore = false;
  while (NS_SUCCEEDED(enumerator->HasMoreElements(&hasMore)) && hasMore) {
    rv = enumerator->GetNext(getter_AddRefs(support));
    NS_ENSURE_SUCCESS(rv, rv);
    directory = do_QueryInterface(support, &rv);
    if (NS_FAILED(rv)) {
      NS_WARNING(
          "Unable to select Address book nsAbManager::GetDirectoryFromId()");
      continue;
    }

    nsCString dirPrefId;
    directory->GetDirPrefId(dirPrefId);
    if (dirPrefId.Equals(aDirPrefId)) {
      directory.forget(aResult);
      return NS_OK;
    }
  }

  return NS_OK;
}

NS_IMETHODIMP nsAbManager::GetDirectory(const nsACString &aURI,
                                        nsIAbDirectory **aResult) {
  NS_ENSURE_ARG_POINTER(aResult);

  nsresult rv;
  nsCOMPtr<nsIAbDirectory> directory;

  // Was the directory root requested?
  if (aURI.EqualsLiteral(kAllDirectoryRoot)) {
    rv = GetRootDirectory(getter_AddRefs(directory));
    NS_ENSURE_SUCCESS(rv, rv);
    directory.forget(aResult);
    return NS_OK;
  }

  // Do we have a copy of this directory already within our look-up table?
  if (!mAbStore.Get(aURI, getter_AddRefs(directory))) {
    // The directory wasn't in our look-up table, so we need to instantiate
    // it. First, extract the scheme from the URI...

    nsAutoCString scheme;

    int32_t colon = aURI.FindChar(':');
    if (colon <= 0) return NS_ERROR_MALFORMED_URI;
    scheme = Substring(aURI, 0, colon);

    // Construct the appropriate nsIAbDirectory...
    nsAutoCString contractID;
    contractID.AssignLiteral(NS_AB_DIRECTORY_TYPE_CONTRACTID_PREFIX);
    contractID.Append(scheme);
    directory = do_CreateInstance(contractID.get(), &rv);
    NS_ENSURE_SUCCESS(rv, rv);

    // Init it with the URI
    rv = directory->Init(PromiseFlatCString(aURI).get());
    NS_ENSURE_SUCCESS(rv, rv);

    // Check if this directory was initiated with a search query.  If so,
    // we don't cache it.
    bool isQuery = false;
    rv = directory->GetIsQuery(&isQuery);
    NS_ENSURE_SUCCESS(rv, rv);

    if (!isQuery) mAbStore.Put(aURI, directory);
  }
  directory.forget(aResult);

  return NS_OK;
}

NS_IMETHODIMP nsAbManager::NewAddressBook(const nsAString &aDirName,
                                          const nsACString &aURI,
                                          const uint32_t aType,
                                          const nsACString &aPrefName,
                                          nsACString &aResult) {
  nsresult rv;

  nsCOMPtr<nsIAbDirectory> parentDir;
  rv = GetRootDirectory(getter_AddRefs(parentDir));
  NS_ENSURE_SUCCESS(rv, rv);
  return parentDir->CreateNewDirectory(aDirName, aURI, aType, aPrefName,
                                       aResult);
}

NS_IMETHODIMP nsAbManager::DeleteAddressBook(const nsACString &aURI) {
  // Find the address book
  nsresult rv;

  nsCOMPtr<nsIAbDirectory> directory;
  rv = GetDirectory(aURI, getter_AddRefs(directory));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIAbDirectory> rootDirectory;
  rv = GetRootDirectory(getter_AddRefs(rootDirectory));
  NS_ENSURE_SUCCESS(rv, rv);

  // Go through each of the children of the address book
  // (so, the mailing lists) and remove their entries from
  // the look up table.
  nsCOMPtr<nsISimpleEnumerator> enumerator;
  rv = directory->GetChildNodes(getter_AddRefs(enumerator));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsISupports> item;
  nsCOMPtr<nsIAbDirectory> childDirectory;
  bool hasMore = false;
  while (NS_SUCCEEDED(enumerator->HasMoreElements(&hasMore)) && hasMore) {
    rv = enumerator->GetNext(getter_AddRefs(item));
    NS_ENSURE_SUCCESS(rv, rv);

    childDirectory = do_QueryInterface(item, &rv);
    if (NS_SUCCEEDED(rv)) {
      nsCString childURI;
      rv = childDirectory->GetURI(childURI);
      NS_ENSURE_SUCCESS(rv, rv);

      mAbStore.Remove(childURI);
    }
  }

  mAbStore.Remove(aURI);

  bool isMailList;
  rv = directory->GetIsMailList(&isMailList);
  NS_ENSURE_SUCCESS(rv, rv);

  if (!isMailList)
    // If we're not a mailing list, then our parent
    // must be the root address book directory.
    return rootDirectory->DeleteDirectory(directory);

  nsCString parentUri;
  parentUri.Append(aURI);
  int32_t pos = parentUri.RFindChar('/');

  // If we didn't find a /, we're in trouble.
  if (pos == -1) return NS_ERROR_FAILURE;

  parentUri = StringHead(parentUri, pos);
  nsCOMPtr<nsIAbDirectory> parentDirectory;
  rv = GetDirectory(parentUri, getter_AddRefs(parentDirectory));
  NS_ENSURE_SUCCESS(rv, rv);

  return parentDirectory->DeleteDirectory(directory);
}

NS_IMETHODIMP nsAbManager::AddAddressBookListener(
    nsIAbListener *aListener, abListenerNotifyFlagValue aNotifyFlags) {
  NS_ENSURE_ARG_POINTER(aListener);

  abListener newListener(aListener, aNotifyFlags);
  mListeners.AppendElementUnlessExists(newListener);
  return NS_OK;
}

NS_IMETHODIMP nsAbManager::RemoveAddressBookListener(nsIAbListener *aListener) {
  NS_ENSURE_ARG_POINTER(aListener);

  mListeners.RemoveElement(aListener);
  return NS_OK;
}

#define NOTIFY_AB_LISTENERS(propertyflag_, propertyfunc_, params_) \
  PR_BEGIN_MACRO                                                   \
  nsTObserverArray<abListener>::ForwardIterator iter(mListeners);  \
  while (iter.HasMore()) {                                         \
    const abListener &abL = iter.GetNext();                        \
    if (abL.mNotifyFlags & nsIAbListener::propertyflag_)           \
      abL.mListener->propertyfunc_ params_;                        \
  }                                                                \
  PR_END_MACRO

NS_IMETHODIMP nsAbManager::NotifyItemPropertyChanged(
    nsISupports *aItem, const char *aProperty, const char16_t *aOldValue,
    const char16_t *aNewValue) {
  NOTIFY_AB_LISTENERS(itemChanged, OnItemPropertyChanged,
                      (aItem, aProperty, aOldValue, aNewValue));
  return NS_OK;
}

NS_IMETHODIMP nsAbManager::NotifyDirectoryItemAdded(
    nsIAbDirectory *aParentDirectory, nsISupports *aItem) {
  NOTIFY_AB_LISTENERS(itemAdded, OnItemAdded, (aParentDirectory, aItem));
  return NS_OK;
}

NS_IMETHODIMP nsAbManager::NotifyDirectoryItemDeleted(
    nsIAbDirectory *aParentDirectory, nsISupports *aItem) {
  NOTIFY_AB_LISTENERS(directoryItemRemoved, OnItemRemoved,
                      (aParentDirectory, aItem));
  return NS_OK;
}

NS_IMETHODIMP nsAbManager::NotifyDirectoryDeleted(
    nsIAbDirectory *aParentDirectory, nsISupports *aDirectory) {
  NOTIFY_AB_LISTENERS(directoryRemoved, OnItemRemoved,
                      (aParentDirectory, aDirectory));
  return NS_OK;
}

NS_IMETHODIMP nsAbManager::GetUserProfileDirectory(nsIFile **userDir) {
  NS_ENSURE_ARG_POINTER(userDir);
  *userDir = nullptr;

  nsresult rv;
  nsCOMPtr<nsIFile> profileDir;
  nsAutoCString pathBuf;

  rv = NS_GetSpecialDirectory(NS_APP_USER_PROFILE_50_DIR,
                              getter_AddRefs(profileDir));
  NS_ENSURE_SUCCESS(rv, rv);

  profileDir.forget(userDir);
  return NS_OK;
}

NS_IMETHODIMP nsAbManager::MailListNameExists(const char16_t *aName,
                                              bool *aExists) {
  nsresult rv;
  NS_ENSURE_ARG_POINTER(aExists);

  *aExists = false;

  // now get the top-level book
  nsCOMPtr<nsIAbDirectory> topDirectory;
  rv = GetRootDirectory(getter_AddRefs(topDirectory));

  // now go through the address books
  nsCOMPtr<nsISimpleEnumerator> enumerator;
  rv = topDirectory->GetChildNodes(getter_AddRefs(enumerator));
  NS_ENSURE_SUCCESS(rv, rv);

  bool hasMore;
  while (NS_SUCCEEDED(enumerator->HasMoreElements(&hasMore)) && hasMore) {
    nsCOMPtr<nsISupports> item;
    rv = enumerator->GetNext(getter_AddRefs(item));
    NS_ENSURE_SUCCESS(rv, rv);

    nsCOMPtr<nsIAbDirectory> directory = do_QueryInterface(item, &rv);
    if (NS_FAILED(rv)) continue;

    rv = directory->HasMailListWithName(aName, aExists);
    if (NS_SUCCEEDED(rv) && *aExists) return NS_OK;
  }

  *aExists = false;
  return NS_OK;
}

#define CSV_DELIM ","
#define CSV_DELIM_LEN 1
#define TAB_DELIM "\t"
#define TAB_DELIM_LEN 1

#define CSV_FILE_EXTENSION ".csv"
#define TAB_FILE_EXTENSION ".tab"
#define TXT_FILE_EXTENSION ".txt"
#define VCF_FILE_EXTENSION ".vcf"
#define LDIF_FILE_EXTENSION ".ldi"
#define LDIF_FILE_EXTENSION2 ".ldif"

enum ADDRESSBOOK_EXPORT_FILE_TYPE {
  CSV_EXPORT_TYPE = 0,
  CSV_EXPORT_TYPE_UTF8 = 1,
  TAB_EXPORT_TYPE = 2,
  TAB_EXPORT_TYPE_UTF8 = 3,
  VCF_EXPORT_TYPE = 4,
  LDIF_EXPORT_TYPE = 5,
};

NS_IMPL_ISUPPORTS(nsAbManager::nsFilePickerShownCallback,
                  nsIFilePickerShownCallback)
nsAbManager::nsFilePickerShownCallback::nsFilePickerShownCallback(
    nsAbManager *aAbManager, nsIFilePicker *aFilePicker,
    nsIAbDirectory *aDirectory)
    : mFilePicker(aFilePicker),
      mAbManager(aAbManager),
      mDirectory(aDirectory) {}

NS_IMETHODIMP nsAbManager::ExportAddressBook(mozIDOMWindowProxy *aParentWin,
                                             nsIAbDirectory *aDirectory) {
  NS_ENSURE_ARG_POINTER(aParentWin);

  nsresult rv;
  nsCOMPtr<nsIFilePicker> filePicker =
      do_CreateInstance("@mozilla.org/filepicker;1", &rv);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIStringBundleService> bundleService =
      mozilla::services::GetStringBundleService();
  NS_ENSURE_TRUE(bundleService, NS_ERROR_UNEXPECTED);
  nsCOMPtr<nsIStringBundle> bundle;
  rv = bundleService->CreateBundle(
      "chrome://messenger/locale/addressbook/addressBook.properties",
      getter_AddRefs(bundle));
  NS_ENSURE_SUCCESS(rv, rv);

  nsString dirName;
  aDirectory->GetDirName(dirName);
  AutoTArray<nsString, 1> formatStrings = {dirName};

  nsString title;
  rv = bundle->FormatStringFromName("ExportAddressBookNameTitle", formatStrings,
                                    title);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = filePicker->Init(aParentWin, title, nsIFilePicker::modeSave);
  NS_ENSURE_SUCCESS(rv, rv);

  filePicker->SetDefaultString(dirName);

  nsString filterString;

  // CSV: System charset and UTF-8.
  rv = bundle->GetStringFromName("CSVFilesSysCharset", filterString);
  NS_ENSURE_SUCCESS(rv, rv);
  rv = filePicker->AppendFilter(filterString, NS_LITERAL_STRING("*.csv"));
  NS_ENSURE_SUCCESS(rv, rv);
  rv = bundle->GetStringFromName("CSVFilesUTF8", filterString);
  NS_ENSURE_SUCCESS(rv, rv);
  rv = filePicker->AppendFilter(filterString, NS_LITERAL_STRING("*.csv"));
  NS_ENSURE_SUCCESS(rv, rv);

  // Tab separated: System charset and UTF-8.
  rv = bundle->GetStringFromName("TABFilesSysCharset", filterString);
  NS_ENSURE_SUCCESS(rv, rv);
  rv =
      filePicker->AppendFilter(filterString, NS_LITERAL_STRING("*.tab; *.txt"));
  NS_ENSURE_SUCCESS(rv, rv);
  rv = bundle->GetStringFromName("TABFilesUTF8", filterString);
  NS_ENSURE_SUCCESS(rv, rv);
  rv =
      filePicker->AppendFilter(filterString, NS_LITERAL_STRING("*.tab; *.txt"));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = bundle->GetStringFromName("VCFFiles", filterString);
  NS_ENSURE_SUCCESS(rv, rv);
  rv = filePicker->AppendFilter(filterString, NS_LITERAL_STRING("*.vcf"));
  NS_ENSURE_SUCCESS(rv, rv);

  rv = bundle->GetStringFromName("LDIFFiles", filterString);
  NS_ENSURE_SUCCESS(rv, rv);
  rv = filePicker->AppendFilter(filterString,
                                NS_LITERAL_STRING("*.ldi; *.ldif"));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIFilePickerShownCallback> callback =
      new nsAbManager::nsFilePickerShownCallback(this, filePicker, aDirectory);
  return filePicker->Open(callback);
}

NS_IMETHODIMP
nsAbManager::nsFilePickerShownCallback::Done(int16_t aResult) {
  nsresult rv;
  if (aResult == nsIFilePicker::returnCancel) return NS_OK;

  nsCOMPtr<nsIFile> localFile;
  rv = mFilePicker->GetFile(getter_AddRefs(localFile));
  NS_ENSURE_SUCCESS(rv, rv);

  if (aResult == nsIFilePicker::returnReplace) {
    // be extra safe and only delete when the file is really a file
    bool isFile;
    rv = localFile->IsFile(&isFile);
    if (NS_SUCCEEDED(rv) && isFile) {
      rv = localFile->Remove(false /* recursive delete */);
      NS_ENSURE_SUCCESS(rv, rv);
    }
  }

  // The type of export is determined by the drop-down in
  // the file picker dialog.
  int32_t exportType;
  rv = mFilePicker->GetFilterIndex(&exportType);
  NS_ENSURE_SUCCESS(rv, rv);

  nsAutoString fileName;
  rv = localFile->GetLeafName(fileName);
  NS_ENSURE_SUCCESS(rv, rv);

  switch (exportType) {
    default:
    case LDIF_EXPORT_TYPE:  // ldif
      // If filename does not have the correct ext, add one.
      if ((MsgFind(fileName, LDIF_FILE_EXTENSION, true,
                   fileName.Length() - strlen(LDIF_FILE_EXTENSION)) == -1) &&
          (MsgFind(fileName, LDIF_FILE_EXTENSION2, true,
                   fileName.Length() - strlen(LDIF_FILE_EXTENSION2)) == -1)) {
        // Add the extension and build a new localFile.
        fileName.AppendLiteral(LDIF_FILE_EXTENSION2);
        localFile->SetLeafName(fileName);
      }
      rv = mAbManager->ExportDirectoryToLDIF(mDirectory, localFile);
      break;

    case CSV_EXPORT_TYPE:  // csv
    case CSV_EXPORT_TYPE_UTF8:
      // If filename does not have the correct ext, add one.
      if (MsgFind(fileName, CSV_FILE_EXTENSION, true,
                  fileName.Length() - strlen(CSV_FILE_EXTENSION)) == -1) {
        // Add the extension and build a new localFile.
        fileName.AppendLiteral(CSV_FILE_EXTENSION);
        localFile->SetLeafName(fileName);
      }
      rv = mAbManager->ExportDirectoryToDelimitedText(
          mDirectory, CSV_DELIM, CSV_DELIM_LEN, localFile,
          exportType == CSV_EXPORT_TYPE_UTF8);
      break;

    case TAB_EXPORT_TYPE:  // tab & text
    case TAB_EXPORT_TYPE_UTF8:
      // If filename does not have the correct ext, add one.
      if ((MsgFind(fileName, TXT_FILE_EXTENSION, true,
                   fileName.Length() - strlen(TXT_FILE_EXTENSION)) == -1) &&
          (MsgFind(fileName, TAB_FILE_EXTENSION, true,
                   fileName.Length() - strlen(TAB_FILE_EXTENSION)) == -1)) {
        // Add the extension and build a new localFile.
        fileName.AppendLiteral(TXT_FILE_EXTENSION);
        localFile->SetLeafName(fileName);
      }
      rv = mAbManager->ExportDirectoryToDelimitedText(
          mDirectory, TAB_DELIM, TAB_DELIM_LEN, localFile,
          exportType == TAB_EXPORT_TYPE_UTF8);
      break;

    case VCF_EXPORT_TYPE:  // vCard
      // If filename does not have the correct ext, add one.
      if (MsgFind(fileName, VCF_FILE_EXTENSION, true,
                  fileName.Length() - strlen(VCF_FILE_EXTENSION)) == -1) {
        // Add the extension and build a new localFile.
        fileName.AppendLiteral(VCF_FILE_EXTENSION);
        localFile->SetLeafName(fileName);
      }
      rv = mAbManager->ExportDirectoryToVCard(mDirectory, localFile);
      break;
  };

  return rv;
}

nsresult nsAbManager::ExportDirectoryToDelimitedText(nsIAbDirectory *aDirectory,
                                                     const char *aDelim,
                                                     uint32_t aDelimLen,
                                                     nsIFile *aLocalFile,
                                                     bool useUTF8) {
  nsCOMPtr<nsISimpleEnumerator> cardsEnumerator;
  nsCOMPtr<nsIAbCard> card;

  nsresult rv;

  nsCOMPtr<nsIOutputStream> outputStream;
  rv = MsgNewBufferedFileOutputStream(getter_AddRefs(outputStream), aLocalFile,
                                      PR_CREATE_FILE | PR_WRONLY | PR_TRUNCATE,
                                      0664);

  // the desired file may be read only
  if (NS_FAILED(rv)) return rv;

  uint32_t i;
  uint32_t writeCount;
  uint32_t length;

  nsCOMPtr<nsIStringBundleService> bundleService =
      mozilla::services::GetStringBundleService();
  NS_ENSURE_TRUE(bundleService, NS_ERROR_UNEXPECTED);

  nsCOMPtr<nsIStringBundle> bundle;
  rv = bundleService->CreateBundle(
      "chrome://messenger/locale/importMsgs.properties",
      getter_AddRefs(bundle));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCString revisedName;
  nsString columnName;

  for (i = 0; i < ArrayLength(EXPORT_ATTRIBUTES_TABLE); i++) {
    if (EXPORT_ATTRIBUTES_TABLE[i].plainTextStringID != 0) {
      // We don't need to truncate the string here as getter_Copies will
      // do that for us.
      if (NS_FAILED(bundle->GetStringFromID(
              EXPORT_ATTRIBUTES_TABLE[i].plainTextStringID, columnName)))
        columnName.AppendInt(EXPORT_ATTRIBUTES_TABLE[i].plainTextStringID);

      if (useUTF8)
        CopyUTF16toUTF8(columnName, revisedName);
      else
        NS_CopyUnicodeToNative(columnName, revisedName);

      rv = outputStream->Write(revisedName.get(), revisedName.Length(),
                               &writeCount);
      NS_ENSURE_SUCCESS(rv, rv);

      if (revisedName.Length() != writeCount) return NS_ERROR_FAILURE;

      if (i < ArrayLength(EXPORT_ATTRIBUTES_TABLE) - 1) {
        rv = outputStream->Write(aDelim, aDelimLen, &writeCount);
        NS_ENSURE_SUCCESS(rv, rv);

        if (aDelimLen != writeCount) return NS_ERROR_FAILURE;
      }
    }
  }
  rv = outputStream->Write(MSG_LINEBREAK, MSG_LINEBREAK_LEN, &writeCount);
  NS_ENSURE_SUCCESS(rv, rv);
  if (MSG_LINEBREAK_LEN != writeCount) return NS_ERROR_FAILURE;

  rv = aDirectory->GetChildCards(getter_AddRefs(cardsEnumerator));
  if (NS_SUCCEEDED(rv) && cardsEnumerator) {
    nsCOMPtr<nsISupports> item;
    bool more;
    while (NS_SUCCEEDED(cardsEnumerator->HasMoreElements(&more)) && more) {
      rv = cardsEnumerator->GetNext(getter_AddRefs(item));
      if (NS_SUCCEEDED(rv)) {
        nsCOMPtr<nsIAbCard> card = do_QueryInterface(item, &rv);
        NS_ENSURE_SUCCESS(rv, rv);

        bool isMailList;
        rv = card->GetIsMailList(&isMailList);
        NS_ENSURE_SUCCESS(rv, rv);

        if (isMailList) {
          // .tab, .txt and .csv aren't able to export mailing lists
          // use LDIF for that.
        } else {
          nsString value;
          nsCString valueCStr;

          for (i = 0; i < ArrayLength(EXPORT_ATTRIBUTES_TABLE); i++) {
            if (EXPORT_ATTRIBUTES_TABLE[i].plainTextStringID != 0) {
              rv = card->GetPropertyAsAString(
                  EXPORT_ATTRIBUTES_TABLE[i].abPropertyName, value);
              if (NS_FAILED(rv)) value.Truncate();

              // If a string contains at least one comma, tab or double quote
              // then we need to quote the entire string. Also if double quote
              // is part of the string we need to quote the double quote(s) as
              // well.
              nsAutoString newValue(value);
              bool needsQuotes = false;
              if (newValue.FindChar('"') != -1) {
                needsQuotes = true;

                int32_t match = 0;
                uint32_t offset = 0;
                nsString oldSubstr = NS_LITERAL_STRING("\"");
                nsString newSubstr = NS_LITERAL_STRING("\"\"");
                while (offset < newValue.Length()) {
                  match = newValue.Find(oldSubstr, offset);
                  if (match == -1) break;

                  newValue.Replace(match, oldSubstr.Length(), newSubstr);
                  offset += (match + newSubstr.Length());
                }
              }
              if (!needsQuotes && (newValue.FindChar(',') != -1 ||
                                   newValue.FindChar('\x09') != -1))
                needsQuotes = true;

              // Make sure we quote if containing CR/LF.
              if (newValue.FindChar('\r') != -1 ||
                  newValue.FindChar('\n') != -1)
                needsQuotes = true;

              if (needsQuotes) {
                newValue.InsertLiteral(u"\"", 0);
                newValue.Append(u'"');
              }

              if (useUTF8)
                CopyUTF16toUTF8(newValue, valueCStr);
              else
                NS_CopyUnicodeToNative(newValue, valueCStr);

              length = valueCStr.Length();
              if (length) {
                rv = outputStream->Write(valueCStr.get(), length, &writeCount);
                NS_ENSURE_SUCCESS(rv, rv);
                if (length != writeCount) return NS_ERROR_FAILURE;
              }
              valueCStr = "";
            } else {
              // something we don't support for the current export
              // for example, .tab doesn't export preferred html format
              continue;  // go to next field
            }

            if (i < ArrayLength(EXPORT_ATTRIBUTES_TABLE) - 1) {
              rv = outputStream->Write(aDelim, aDelimLen, &writeCount);
              NS_ENSURE_SUCCESS(rv, rv);
              if (aDelimLen != writeCount) return NS_ERROR_FAILURE;
            }
          }

          // write out the linebreak that separates the cards
          rv = outputStream->Write(MSG_LINEBREAK, MSG_LINEBREAK_LEN,
                                   &writeCount);
          NS_ENSURE_SUCCESS(rv, rv);
          if (MSG_LINEBREAK_LEN != writeCount) return NS_ERROR_FAILURE;
        }
      }
    }
  }

  rv = outputStream->Flush();
  NS_ENSURE_SUCCESS(rv, rv);

  rv = outputStream->Close();
  NS_ENSURE_SUCCESS(rv, rv);
  return NS_OK;
}

nsresult nsAbManager::ExportDirectoryToVCard(nsIAbDirectory *aDirectory,
                                             nsIFile *aLocalFile) {
  nsCOMPtr<nsISimpleEnumerator> cardsEnumerator;
  nsCOMPtr<nsIAbCard> card;

  nsresult rv;

  nsCOMPtr<nsIOutputStream> outputStream;
  rv = MsgNewBufferedFileOutputStream(getter_AddRefs(outputStream), aLocalFile,
                                      PR_CREATE_FILE | PR_WRONLY | PR_TRUNCATE,
                                      0664);

  // the desired file may be read only
  if (NS_FAILED(rv)) return rv;

  uint32_t writeCount;
  uint32_t length;

  rv = aDirectory->GetChildCards(getter_AddRefs(cardsEnumerator));
  if (NS_SUCCEEDED(rv) && cardsEnumerator) {
    nsCOMPtr<nsISupports> item;
    bool more;
    while (NS_SUCCEEDED(cardsEnumerator->HasMoreElements(&more)) && more) {
      rv = cardsEnumerator->GetNext(getter_AddRefs(item));
      if (NS_SUCCEEDED(rv)) {
        nsCOMPtr<nsIAbCard> card = do_QueryInterface(item, &rv);
        NS_ENSURE_SUCCESS(rv, rv);

        bool isMailList;
        rv = card->GetIsMailList(&isMailList);
        NS_ENSURE_SUCCESS(rv, rv);

        if (isMailList) {
          // we don't know how to export mailing lists to vcf
          // use LDIF for that.
        } else {
          nsCString escapedValue;
          rv = card->TranslateTo(NS_LITERAL_CSTRING("vcard"), escapedValue);
          NS_ENSURE_SUCCESS(rv, rv);

          nsCString valueCStr;
          MsgUnescapeString(escapedValue, 0, valueCStr);

          length = valueCStr.Length();
          rv = outputStream->Write(valueCStr.get(), length, &writeCount);
          NS_ENSURE_SUCCESS(rv, rv);
          if (length != writeCount) return NS_ERROR_FAILURE;
        }
      }
    }
  }

  rv = outputStream->Flush();
  NS_ENSURE_SUCCESS(rv, rv);

  rv = outputStream->Close();
  NS_ENSURE_SUCCESS(rv, rv);
  return NS_OK;
}

nsresult nsAbManager::ExportDirectoryToLDIF(nsIAbDirectory *aDirectory,
                                            nsIFile *aLocalFile) {
  nsCOMPtr<nsISimpleEnumerator> cardsEnumerator;
  nsCOMPtr<nsIAbCard> card;

  nsresult rv;

  nsCOMPtr<nsIOutputStream> outputStream;
  rv = MsgNewBufferedFileOutputStream(getter_AddRefs(outputStream), aLocalFile,
                                      PR_CREATE_FILE | PR_WRONLY | PR_TRUNCATE,
                                      0664);

  // the desired file may be read only
  if (NS_FAILED(rv)) return rv;

  // Get the default attribute map for ldap. We use the default attribute
  // map rather than one for a specific server because if people want an
  // ldif export using a servers specific schema, then they can use ldapsearch
  nsCOMPtr<nsIAbLDAPAttributeMapService> mapSrv = do_GetService(
      "@mozilla.org/addressbook/ldap-attribute-map-service;1", &rv);
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIAbLDAPAttributeMap> attrMap;
  rv = mapSrv->GetMapForPrefBranch(
      NS_LITERAL_CSTRING("ldap_2.servers.default.attrmap"),
      getter_AddRefs(attrMap));
  NS_ENSURE_SUCCESS(rv, rv);

  uint32_t i;
  uint32_t writeCount;
  uint32_t length;

  rv = aDirectory->GetChildCards(getter_AddRefs(cardsEnumerator));
  if (NS_SUCCEEDED(rv) && cardsEnumerator) {
    nsCOMPtr<nsISupports> item;
    bool more;
    while (NS_SUCCEEDED(cardsEnumerator->HasMoreElements(&more)) && more) {
      rv = cardsEnumerator->GetNext(getter_AddRefs(item));
      if (NS_SUCCEEDED(rv)) {
        nsCOMPtr<nsIAbCard> card = do_QueryInterface(item, &rv);
        NS_ENSURE_SUCCESS(rv, rv);

        bool isMailList;
        rv = card->GetIsMailList(&isMailList);
        NS_ENSURE_SUCCESS(rv, rv);

        if (isMailList) {
          nsCString mailListCStr;

          rv = AppendLDIFForMailList(card, attrMap, mailListCStr);
          NS_ENSURE_SUCCESS(rv, rv);

          length = mailListCStr.Length();
          rv = outputStream->Write(mailListCStr.get(), length, &writeCount);
          NS_ENSURE_SUCCESS(rv, rv);
          if (length != writeCount) return NS_ERROR_FAILURE;
        } else {
          nsString value;
          nsCString valueCStr;

          rv = AppendBasicLDIFForCard(card, attrMap, valueCStr);
          NS_ENSURE_SUCCESS(rv, rv);

          length = valueCStr.Length();
          rv = outputStream->Write(valueCStr.get(), length, &writeCount);
          NS_ENSURE_SUCCESS(rv, rv);
          if (length != writeCount) return NS_ERROR_FAILURE;

          valueCStr.Truncate();

          nsAutoCString ldapAttribute;

          for (i = 0; i < ArrayLength(EXPORT_ATTRIBUTES_TABLE); i++) {
            if (NS_SUCCEEDED(attrMap->GetFirstAttribute(
                    nsDependentCString(
                        EXPORT_ATTRIBUTES_TABLE[i].abPropertyName),
                    ldapAttribute)) &&
                !ldapAttribute.IsEmpty()) {
              rv = card->GetPropertyAsAString(
                  EXPORT_ATTRIBUTES_TABLE[i].abPropertyName, value);
              if (NS_FAILED(rv)) value.Truncate();

              if (!PL_strcmp(EXPORT_ATTRIBUTES_TABLE[i].abPropertyName,
                             kPreferMailFormatProperty)) {
                if (value.EqualsLiteral("html"))
                  value.AssignLiteral("true");
                else if (value.EqualsLiteral("plaintext"))
                  value.AssignLiteral("false");
                else
                  value.Truncate();  // unknown.
              }

              if (!value.IsEmpty()) {
                rv =
                    AppendProperty(ldapAttribute.get(), value.get(), valueCStr);
                NS_ENSURE_SUCCESS(rv, rv);

                valueCStr += MSG_LINEBREAK;
              } else
                valueCStr.Truncate();

              length = valueCStr.Length();
              if (length) {
                rv = outputStream->Write(valueCStr.get(), length, &writeCount);
                NS_ENSURE_SUCCESS(rv, rv);
                if (length != writeCount) return NS_ERROR_FAILURE;
              }
              valueCStr.Truncate();
            } else {
              // something we don't support yet
              // ldif doesn't export multiple addresses
            }
          }

          // write out the linebreak that separates the cards
          rv = outputStream->Write(MSG_LINEBREAK, MSG_LINEBREAK_LEN,
                                   &writeCount);
          NS_ENSURE_SUCCESS(rv, rv);
          if (MSG_LINEBREAK_LEN != writeCount) return NS_ERROR_FAILURE;
        }
      }
    }
  }

  rv = outputStream->Flush();
  NS_ENSURE_SUCCESS(rv, rv);

  rv = outputStream->Close();
  NS_ENSURE_SUCCESS(rv, rv);
  return NS_OK;
}

nsresult nsAbManager::AppendLDIFForMailList(nsIAbCard *aCard,
                                            nsIAbLDAPAttributeMap *aAttrMap,
                                            nsACString &aResult) {
  nsresult rv;
  nsString attrValue;

  rv = AppendDNForCard("dn", aCard, aAttrMap, aResult);
  NS_ENSURE_SUCCESS(rv, rv);

  aResult += MSG_LINEBREAK "objectclass: top" MSG_LINEBREAK
                           "objectclass: groupOfNames" MSG_LINEBREAK;

  rv = aCard->GetDisplayName(attrValue);
  NS_ENSURE_SUCCESS(rv, rv);

  nsAutoCString ldapAttributeName;

  rv = aAttrMap->GetFirstAttribute(NS_LITERAL_CSTRING(kDisplayNameProperty),
                                   ldapAttributeName);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = AppendProperty(ldapAttributeName.get(), attrValue.get(), aResult);
  NS_ENSURE_SUCCESS(rv, rv);
  aResult += MSG_LINEBREAK;

  rv = aAttrMap->GetFirstAttribute(NS_LITERAL_CSTRING(kNicknameProperty),
                                   ldapAttributeName);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = aCard->GetPropertyAsAString(kNicknameProperty, attrValue);
  if (NS_SUCCEEDED(rv) && !attrValue.IsEmpty()) {
    rv = AppendProperty(ldapAttributeName.get(), attrValue.get(), aResult);
    NS_ENSURE_SUCCESS(rv, rv);
    aResult += MSG_LINEBREAK;
  }

  rv = aAttrMap->GetFirstAttribute(NS_LITERAL_CSTRING(kNotesProperty),
                                   ldapAttributeName);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = aCard->GetPropertyAsAString(kNotesProperty, attrValue);
  if (NS_SUCCEEDED(rv) && !attrValue.IsEmpty()) {
    rv = AppendProperty(ldapAttributeName.get(), attrValue.get(), aResult);
    NS_ENSURE_SUCCESS(rv, rv);
    aResult += MSG_LINEBREAK;
  }

  nsCString mailListURI;
  rv = aCard->GetMailListURI(getter_Copies(mailListURI));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIAbDirectory> mailList;
  rv = GetDirectory(mailListURI, getter_AddRefs(mailList));
  NS_ENSURE_SUCCESS(rv, rv);

  nsCOMPtr<nsIMutableArray> addresses;
  rv = mailList->GetAddressLists(getter_AddRefs(addresses));
  if (addresses) {
    uint32_t total = 0;
    addresses->GetLength(&total);
    if (total) {
      uint32_t i;
      for (i = 0; i < total; i++) {
        nsCOMPtr<nsIAbCard> listCard = do_QueryElementAt(addresses, i, &rv);
        NS_ENSURE_SUCCESS(rv, rv);

        rv = AppendDNForCard("member", listCard, aAttrMap, aResult);
        NS_ENSURE_SUCCESS(rv, rv);

        aResult += MSG_LINEBREAK;
      }
    }
  }

  aResult += MSG_LINEBREAK;
  return NS_OK;
}

nsresult nsAbManager::AppendDNForCard(const char *aProperty, nsIAbCard *aCard,
                                      nsIAbLDAPAttributeMap *aAttrMap,
                                      nsACString &aResult) {
  nsString email;
  nsString displayName;
  nsAutoCString ldapAttributeName;

  nsresult rv = aCard->GetPrimaryEmail(email);
  NS_ENSURE_SUCCESS(rv, rv);

  rv = aCard->GetDisplayName(displayName);
  NS_ENSURE_SUCCESS(rv, rv);

  nsString cnStr;

  rv = aAttrMap->GetFirstAttribute(NS_LITERAL_CSTRING(kDisplayNameProperty),
                                   ldapAttributeName);
  NS_ENSURE_SUCCESS(rv, rv);

  if (!displayName.IsEmpty()) {
    cnStr += NS_ConvertUTF8toUTF16(ldapAttributeName).get();
    cnStr.Append('=');
    cnStr.Append(displayName);
    if (!email.IsEmpty()) {
      cnStr.Append(',');
    }
  }

  rv = aAttrMap->GetFirstAttribute(NS_LITERAL_CSTRING(kPriEmailProperty),
                                   ldapAttributeName);
  NS_ENSURE_SUCCESS(rv, rv);

  if (!email.IsEmpty()) {
    cnStr += NS_ConvertUTF8toUTF16(ldapAttributeName).get();
    cnStr.Append('=');
    cnStr.Append(email);
  }

  rv = AppendProperty(aProperty, cnStr.get(), aResult);
  NS_ENSURE_SUCCESS(rv, rv);
  return rv;
}

nsresult nsAbManager::AppendBasicLDIFForCard(nsIAbCard *aCard,
                                             nsIAbLDAPAttributeMap *aAttrMap,
                                             nsACString &aResult) {
  nsresult rv = AppendDNForCard("dn", aCard, aAttrMap, aResult);
  NS_ENSURE_SUCCESS(rv, rv);
  aResult += MSG_LINEBREAK "objectclass: top" MSG_LINEBREAK
                           "objectclass: person" MSG_LINEBREAK
                           "objectclass: organizationalPerson" MSG_LINEBREAK
                           "objectclass: inetOrgPerson" MSG_LINEBREAK
                           "objectclass: " MOZ_AB_OBJECTCLASS MSG_LINEBREAK;
  return rv;
}

bool nsAbManager::IsSafeLDIFString(const char16_t *aStr) {
  // follow RFC 2849 to determine if something is safe "as is" for LDIF
  if (aStr[0] == char16_t(' ') || aStr[0] == char16_t(':') ||
      aStr[0] == char16_t('<'))
    return false;

  uint32_t i;
  uint32_t len = NS_strlen(aStr);
  for (i = 0; i < len; i++) {
    // If string contains CR or LF, it is not safe for LDIF
    // and MUST be base64 encoded
    if ((aStr[i] == char16_t('\n')) || (aStr[i] == char16_t('\r')) ||
        (!mozilla::IsAscii(aStr[i])))
      return false;
  }
  return true;
}

nsresult nsAbManager::AppendProperty(const char *aProperty,
                                     const char16_t *aValue,
                                     nsACString &aResult) {
  NS_ENSURE_ARG_POINTER(aValue);

  aResult += aProperty;

  // if the string is not safe "as is", base64 encode it
  if (IsSafeLDIFString(aValue)) {
    aResult.AppendLiteral(": ");
    aResult.Append(NS_LossyConvertUTF16toASCII(aValue));
  } else {
    char *base64Str =
        PL_Base64Encode(NS_ConvertUTF16toUTF8(aValue).get(), 0, nullptr);
    if (!base64Str) return NS_ERROR_OUT_OF_MEMORY;

    aResult.AppendLiteral(":: ");
    aResult.Append(nsDependentCString(base64Str));
    PR_Free(base64Str);
  }

  return NS_OK;
}

char *getCString(VObject *vObj) {
  if (VALUE_TYPE(vObj) == VCVT_USTRINGZ)
    return fakeCString(vObjectUStringZValue(vObj));
  if (VALUE_TYPE(vObj) == VCVT_STRINGZ)
    return PL_strdup(vObjectStringZValue(vObj));
  return NULL;
}

static void convertNameValue(VObject *vObj, nsIAbCard *aCard) {
  const char *cardPropName = NULL;

  // if the vCard property is not a root property then we need to determine its
  // exact property. a good example of this is VCTelephoneProp, this prop has
  // four objects underneath it: fax, work and home and cellular.
  if (PL_strcasecmp(VCCityProp, vObjectName(vObj)) == 0)
    cardPropName = kWorkCityProperty;
  else if (PL_strcasecmp(VCTelephoneProp, vObjectName(vObj)) == 0) {
    if (isAPropertyOf(vObj, VCFaxProp))
      cardPropName = kFaxProperty;
    else if (isAPropertyOf(vObj, VCWorkProp))
      cardPropName = kWorkPhoneProperty;
    else if (isAPropertyOf(vObj, VCHomeProp))
      cardPropName = kHomePhoneProperty;
    else if (isAPropertyOf(vObj, VCCellularProp))
      cardPropName = kCellularProperty;
    else if (isAPropertyOf(vObj, VCPagerProp))
      cardPropName = kPagerProperty;
    else
      return;
  } else if (PL_strcasecmp(VCEmailAddressProp, vObjectName(vObj)) == 0)
    cardPropName = kPriEmailProperty;
  else if (PL_strcasecmp(VCFamilyNameProp, vObjectName(vObj)) == 0)
    cardPropName = kLastNameProperty;
  else if (PL_strcasecmp(VCFullNameProp, vObjectName(vObj)) == 0)
    cardPropName = kDisplayNameProperty;
  else if (PL_strcasecmp(VCGivenNameProp, vObjectName(vObj)) == 0)
    cardPropName = kFirstNameProperty;
  else if (PL_strcasecmp(VCOrgNameProp, vObjectName(vObj)) == 0)
    cardPropName = kCompanyProperty;
  else if (PL_strcasecmp(VCOrgUnitProp, vObjectName(vObj)) == 0)
    cardPropName = kDepartmentProperty;
  else if (PL_strcasecmp(VCPostalCodeProp, vObjectName(vObj)) == 0)
    cardPropName = kWorkZipCodeProperty;
  else if (PL_strcasecmp(VCRegionProp, vObjectName(vObj)) == 0)
    cardPropName = kWorkStateProperty;
  else if (PL_strcasecmp(VCStreetAddressProp, vObjectName(vObj)) == 0)
    cardPropName = kWorkAddressProperty;
  else if (PL_strcasecmp(VCPostalBoxProp, vObjectName(vObj)) == 0)
    cardPropName = kWorkAddress2Property;
  else if (PL_strcasecmp(VCCountryNameProp, vObjectName(vObj)) == 0)
    cardPropName = kWorkCountryProperty;
  else if (PL_strcasecmp(VCTitleProp, vObjectName(vObj)) == 0)
    cardPropName = kJobTitleProperty;
  else if (PL_strcasecmp(VCUseHTML, vObjectName(vObj)) == 0)
    cardPropName = kPreferMailFormatProperty;
  else if (PL_strcasecmp(VCNoteProp, vObjectName(vObj)) == 0)
    cardPropName = kNotesProperty;
  else if (PL_strcasecmp(VCURLProp, vObjectName(vObj)) == 0)
    cardPropName = kWorkWebPageProperty;
  else
    return;

  if (!VALUE_TYPE(vObj)) return;

  char *cardPropValue = getCString(vObj);
  if (PL_strcmp(cardPropName, kPreferMailFormatProperty)) {
    aCard->SetPropertyAsAUTF8String(cardPropName,
                                    nsDependentCString(cardPropValue));
  } else {
    if (!PL_strcmp(cardPropValue, "TRUE"))
      aCard->SetPropertyAsUint32(cardPropName, nsIAbPreferMailFormat::html);
    else if (!PL_strcmp(cardPropValue, "FALSE"))
      aCard->SetPropertyAsUint32(cardPropName,
                                 nsIAbPreferMailFormat::plaintext);
    else
      aCard->SetPropertyAsUint32(cardPropName, nsIAbPreferMailFormat::unknown);
  }
  PR_FREEIF(cardPropValue);
  return;
}

static void convertFromVObject(VObject *vObj, nsIAbCard *aCard) {
  if (vObj) {
    VObjectIterator t;

    convertNameValue(vObj, aCard);

    initPropIterator(&t, vObj);
    while (moreIteration(&t)) {
      VObject *nextObject = nextVObject(&t);
      convertFromVObject(nextObject, aCard);
    }
  }
  return;
}

NS_IMETHODIMP nsAbManager::EscapedVCardToAbCard(const char *aEscapedVCardStr,
                                                nsIAbCard **aCard) {
  NS_ENSURE_ARG_POINTER(aEscapedVCardStr);
  NS_ENSURE_ARG_POINTER(aCard);

  nsCOMPtr<nsIAbCard> cardFromVCard =
      do_CreateInstance(NS_ABCARDPROPERTY_CONTRACTID);
  if (!cardFromVCard) return NS_ERROR_FAILURE;

  // aEscapedVCardStr will be "" the first time, before you have a vCard
  if (*aEscapedVCardStr != '\0') {
    nsCString unescapedData;
    MsgUnescapeString(nsDependentCString(aEscapedVCardStr), 0, unescapedData);

    VObject *vObj = parse_MIME(unescapedData.get(), unescapedData.Length());
    if (vObj) {
      convertFromVObject(vObj, cardFromVCard);

      cleanVObject(vObj);
    } else
      NS_WARNING("Parse of vCard failed");
  }

  cardFromVCard.forget(aCard);
  return NS_OK;
}

NS_IMETHODIMP
nsAbManager::Handle(nsICommandLine *aCmdLine) {
  nsresult rv;
  bool found;

  rv = aCmdLine->HandleFlag(NS_LITERAL_STRING("addressbook"), false, &found);
  NS_ENSURE_SUCCESS(rv, rv);

  if (!found) return NS_OK;

  nsCOMPtr<nsIWindowWatcher> wwatch(do_GetService(NS_WINDOWWATCHER_CONTRACTID));
  NS_ENSURE_TRUE(wwatch, NS_ERROR_FAILURE);

  nsCOMPtr<mozIDOMWindowProxy> opened;
  wwatch->OpenWindow(
      nullptr, "chrome://messenger/content/addressbook/addressbook.xul",
      "_blank",
      "chrome,extrachrome,menubar,resizable,scrollbars,status,toolbar", nullptr,
      getter_AddRefs(opened));
  aCmdLine->SetPreventDefault(true);
  return NS_OK;
}

NS_IMETHODIMP
nsAbManager::GetHelpInfo(nsACString &aResult) {
  aResult.AssignLiteral(
      "  -addressbook       Open the address book at startup.\n");
  return NS_OK;
}

NS_IMETHODIMP
nsAbManager::GenerateUUID(const nsACString &aDirectoryId,
                          const nsACString &aLocalId, nsACString &uuid) {
  uuid.Assign(aDirectoryId);
  uuid.Append('#');
  uuid.Append(aLocalId);
  return NS_OK;
}

NS_IMETHODIMP
nsAbManager::ConvertQueryStringToExpression(const nsACString &aQueryString,
                                            nsIAbBooleanExpression **_retval) {
  NS_ENSURE_ARG_POINTER(_retval);
  return nsAbQueryStringToExpression::Convert(aQueryString, _retval);
}
