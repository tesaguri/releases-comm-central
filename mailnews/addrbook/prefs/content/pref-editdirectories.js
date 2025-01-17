/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from ../../../../mail/components/addrbook/content/abCommon.js */

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { MailServices } = ChromeUtils.import(
  "resource:///modules/MailServices.jsm"
);

// Listener to refresh the list items if something changes. In all these
// cases we just rebuild the list as it is easier than searching/adding in the
// correct places an would be an infrequent operation.
var gAddressBookAbListener = {
  onItemAdded(parentDir, item) {
    if (item instanceof Ci.nsIAbDirectory) {
      fillDirectoryList(item);
    }
  },
  onItemRemoved(parentDir, item) {
    if (item instanceof Ci.nsIAbDirectory) {
      fillDirectoryList();
    }
  },
  onItemPropertyChanged(item, property, oldValue, newValue) {
    if (item instanceof Ci.nsIAbDirectory) {
      fillDirectoryList(item);
    }
  },
};

function onInitEditDirectories() {
  // For AbDeleteDirectory in abCommon.js
  gAddressBookBundle = document.getElementById("bundle_addressBook");

  // If the pref is locked disable the "Add" button
  if (Services.prefs.prefIsLocked("ldap_2.disable_button_add")) {
    document.getElementById("addButton").setAttribute("disabled", true);
  }

  // Fill out the directory list
  fillDirectoryList();

  const nsIAbListener = Ci.nsIAbListener;
  // Add a listener so we can update correctly if the list should change
  MailServices.ab.addAddressBookListener(
    gAddressBookAbListener,
    nsIAbListener.itemAdded |
      nsIAbListener.directoryRemoved |
      nsIAbListener.itemChanged
  );
}

function onUninitEditDirectories() {
  MailServices.ab.removeAddressBookListener(gAddressBookAbListener);
}

function fillDirectoryList(aItem = null) {
  var abList = document.getElementById("directoriesList");

  // Empty out anything in the list
  while (abList.hasChildNodes()) {
    abList.lastChild.remove();
  }

  // Init the address book list
  let directories = MailServices.ab.directories;
  let holdingArray = [];
  while (directories && directories.hasMoreElements()) {
    let ab = directories.getNext();
    if (ab instanceof Ci.nsIAbDirectory && ab.isRemote) {
      holdingArray.push(ab);
    }
  }

  holdingArray.sort(function(a, b) {
    return a.dirName.localeCompare(b.dirName);
  });

  holdingArray.forEach(function(ab) {
    let item = document.createXULElement("richlistitem");
    let label = document.createXULElement("label");
    label.setAttribute("value", ab.dirName);
    item.appendChild(label);
    item.setAttribute("value", ab.URI);

    abList.appendChild(item);
  });

  // Forces the focus back on the list and on the first item.
  // We also select an edited or recently added item.
  abList.focus();
  if (aItem) {
    abList.selectedIndex = holdingArray.findIndex(d => {
      return d && d.URI == aItem.URI;
    });
  }
}

function selectDirectory() {
  var abList = document.getElementById("directoriesList");
  var editButton = document.getElementById("editButton");
  var removeButton = document.getElementById("removeButton");

  if (abList && abList.selectedItem) {
    editButton.removeAttribute("disabled");

    // If the disable delete button pref for the selected directory is set,
    // disable the delete button for that directory.
    let ab = MailServices.ab.getDirectory(abList.value);
    let disable = Services.prefs.getBoolPref(
      ab.dirPrefId + ".disable_delete",
      false
    );
    if (disable) {
      removeButton.setAttribute("disabled", true);
    } else {
      removeButton.removeAttribute("disabled");
    }
  } else {
    editButton.setAttribute("disabled", true);
    removeButton.setAttribute("disabled", true);
  }
}

function dblClickDirectory(event) {
  // We only care about left click events.
  if (event.button != 0) {
    return;
  }

  editDirectory();
}

function editDirectory() {
  var abList = document.getElementById("directoriesList");

  if (abList && abList.selectedItem) {
    let abURI = abList.value;
    let ab = MailServices.ab.getDirectory(abURI);

    window.docShell.rootTreeItem.domWindow.openDialog(
      ab.propertiesChromeURI,
      "editDirectory",
      "chrome,modal=yes,resizable=no",
      { selectedDirectory: ab }
    );
  }
}

function removeDirectory() {
  var abList = document.getElementById("directoriesList");

  if (abList && abList.selectedItem) {
    AbDeleteDirectory(abList.value);
  }
}
