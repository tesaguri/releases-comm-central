/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Weave should always exist before before this file gets included.
var gSyncUtils = {
  _openLink: function (url) {
    if (document.documentElement.id == "change-dialog")
      Services.wm.getMostRecentWindow("navigator:browser")
                 .openUILinkIn(url, "tab");
    else
      openUILinkIn(url, "tab");
  },

  changeName: function changeName(input) {
    // Make sure to update to a modified name, e.g., empty-string -> default
    Weave.Service.clientsEngine.localName = input.value;
    input.value = Weave.Service.clientsEngine.localName;
  },

  openChange: function openChange(type, duringSetup) {
    // Just re-show the dialog if it's already open
    let openedDialog = Services.wm.getMostRecentWindow("Sync:" + type);
    if (openedDialog != null) {
      openedDialog.focus();
      return;
    }

    // Open up the change dialog
    let changeXUL = "chrome://communicator/content/sync/syncGenericChange.xul";
    let changeOpt = "centerscreen,chrome,resizable=no";
    Services.ww.activeWindow.openDialog(changeXUL, "", changeOpt,
                                        type, duringSetup);
  },

  changePassword: function () {
    if (Weave.Utils.ensureMPUnlocked())
      this.openChange("ChangePassword");
  },

  resetPassphrase: function (duringSetup) {
    if (Weave.Utils.ensureMPUnlocked())
      this.openChange("ResetPassphrase", duringSetup);
  },

  updatePassphrase: function () {
    if (Weave.Utils.ensureMPUnlocked())
      this.openChange("UpdatePassphrase");
  },

  resetPassword: function () {
    this._openLink(Weave.Service.pwResetURL);
  },

  openToS: function () {
    this._openLink(Weave.Svc.Prefs.get("termsURL"));
  },

  openPrivacyPolicy: function () {
    this._openLink(Weave.Svc.Prefs.get("privacyURL"));
  },

  // xxxmpc - fix domain before 1.3 final (bug 583652)
  // xxxInvisibleSmiley - we should really have our own pages
  // since these refer to Firefox in the page contents
  _baseURL: "http://www.mozilla.com/firefox/sync/",

  openFirstClientFirstrun: function () {
    let url = this._baseURL + "firstrun.html";
    this._openLink(url);
  },

  openAddedClientFirstrun: function () {
    let url = this._baseURL + "secondrun.html";
    this._openLink(url);
  },

  /**
   * Prepare an invisible iframe with the passphrase backup document.
   * Used by both the print and saving methods.
   *
   * @param elid : ID of the form element containing the passphrase.
   * @param callback : Function called once the iframe has loaded.
   */
  _preparePPiframe: function(elid, callback) {
    let pp = document.getElementById(elid).value;

    // Create an invisible iframe whose contents we can print.
    let iframe = document.createElement("iframe");
    iframe.setAttribute("src", "chrome://communicator/content/sync/syncKey.xhtml");
    iframe.setAttribute("type", "content");
    iframe.collapsed = true;
    document.documentElement.appendChild(iframe);
    iframe.addEventListener("load", function loadListener() {
      iframe.removeEventListener("load", loadListener, true);

      // Remove the license block.
      let node = iframe.contentDocument.firstChild;
      if (node && node.nodeType == Node.COMMENT_NODE)
        node.remove();

      // Insert the Sync Key into the page.
      let el = iframe.contentDocument.getElementById("synckey");
      el.firstChild.nodeValue = pp;

      // Insert the TOS and Privacy Policy URLs into the page.
      let termsURL = Weave.Svc.Prefs.get("termsURL");
      el = iframe.contentDocument.getElementById("tosLink");
      el.setAttribute("href", termsURL);
      el.firstChild.nodeValue = termsURL;

      let privacyURL = Weave.Svc.Prefs.get("privacyURL");
      el = iframe.contentDocument.getElementById("ppLink");
      el.setAttribute("href", privacyURL);
      el.firstChild.nodeValue = privacyURL;

      callback(iframe);
    }, true);
  },

  /**
   * Print passphrase backup document.
   *
   * @param elid : ID of the form element containing the passphrase.
   */
  passphrasePrint: function(elid) {
    this._preparePPiframe(elid, function(iframe) {
      let webBrowserPrint = iframe.contentWindow
                                  .QueryInterface(Ci.nsIInterfaceRequestor)
                                  .getInterface(Ci.nsIWebBrowserPrint);
      let printSettings = PrintUtils.getPrintSettings();

      // Display no header/footer decoration except for the date.
      printSettings.headerStrLeft
        = printSettings.headerStrCenter
        = printSettings.headerStrRight
        = printSettings.footerStrLeft
        = printSettings.footerStrCenter = "";
      printSettings.footerStrRight = "&D";

      try {
        webBrowserPrint.print(printSettings, null);
      } catch (ex) {
        // print()'s return codes are expressed as exceptions. Ignore.
      }
    });
  },

  /**
   * Save passphrase backup document to disk as HTML file.
   *
   * @param elid : ID of the form element containing the passphrase.
   */
  passphraseSave: function(elid) {
    let dialogTitle = this._stringBundle.GetStringFromName("save.recoverykey.title");
    let defaultSaveName = this._stringBundle.GetStringFromName("save.recoverykey.defaultfilename");
    this._preparePPiframe(elid, function(iframe) {
      let filepicker = Cc["@mozilla.org/filepicker;1"]
                         .createInstance(Ci.nsIFilePicker);
      filepicker.init(window, dialogTitle, Ci.nsIFilePicker.modeSave);
      filepicker.appendFilters(Ci.nsIFilePicker.filterHTML);
      filepicker.defaultString = defaultSaveName;
      let rv = filepicker.show();
      if (rv == Ci.nsIFilePicker.returnOK
          || rv == Ci.nsIFilePicker.returnReplace) {
        let stream = Cc["@mozilla.org/network/file-output-stream;1"]
                       .createInstance(Ci.nsIFileOutputStream);
        stream.init(filepicker.file, -1, parseInt("0600", 8), 0);

        let serializer = new XMLSerializer();
        let output = serializer.serializeToString(iframe.contentDocument);
        output = output.replace(/<!DOCTYPE (.|\n)*?]>/,
          '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" ' +
          '"DTD/xhtml1-strict.dtd">');
        output = Weave.Utils.encodeUTF8(output);
        stream.write(output, output.length);
      }
      return false;
    });
  },

  /**
   * validatePassword
   *
   * @param el1 : the first textbox element in the form
   * @param el2 : the second textbox element, if omitted it's an update form
   *
   * returns [valid, errorString]
   */
  validatePassword: function (el1, el2) {
    let valid = false;
    let val1 = el1.value;
    let val2 = el2 ? el2.value : "";
    let error = "";

    if (!el2)
      valid = val1.length >= Weave.MIN_PASS_LENGTH;
    else if (val1 && val1 == Weave.Service.identity.username)
      error = "change.password.pwSameAsUsername";
    else if (val1 && val1 == Weave.Service.identity.account)
      error = "change.password.pwSameAsEmail";
    else if (val1 && val1 == Weave.Service.identity.basicPassword)
      error = "change.password.pwSameAsPassword";
    else if (val1 && val1 == Weave.Service.identity.syncKey)
      error = "change.password.pwSameAsRecoveryKey";
    else if (val1 && val2) {
      if (val1 == val2 && val1.length >= Weave.MIN_PASS_LENGTH)
        valid = true;
      else if (val1.length < Weave.MIN_PASS_LENGTH)
        error = "change.password.tooShort";
      else if (val1 != val2)
        error = "change.password.mismatch";
    }
    let errorString = error ? Weave.Utils.getErrorString(error) : "";
    return [valid, errorString];
  }
};

ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
XPCOMUtils.defineLazyGetter(gSyncUtils, "_stringBundle", function() {
  return Components.classes["@mozilla.org/intl/stringbundle;1"]
                   .getService(Components.interfaces.nsIStringBundleService)
                   .createBundle("chrome://communicator/locale/sync/syncSetup.properties");
});
