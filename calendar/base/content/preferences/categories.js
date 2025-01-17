/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported gCategoriesPane */

/* import-globals-from ../../../lightning/content/messenger-overlay-preferences.js */
// From categories.xul.
/* globals noneLabel, newTitle, editTitle, overwrite, overwriteTitle, noBlankCategories */

var { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { AppConstants } = ChromeUtils.import("resource://gre/modules/AppConstants.jsm");

Preferences.add({ id: "calendar.categories.names", type: "string" });

var gCategoryList;
var categoryPrefBranch = Services.prefs.getBranch("calendar.category.color.");

/**
 * Global Object to hold methods for the categories pref pane
 */
var gCategoriesPane = {
  mCategoryDialog: null,
  mWinProp: null,

  /**
   * Initialize the categories pref pane. Sets up dialog controls to show the
   * categories saved in preferences.
   */
  init: function() {
    // On non-instant-apply platforms, once this pane has been loaded,
    // attach our "revert all changes" function to the parent prefwindow's
    // "ondialogcancel" event.
    let parentPrefWindow = document.documentElement;
    if (!parentPrefWindow.instantApply) {
      let existingOnDialogCancel = parentPrefWindow.getAttribute("ondialogcancel");
      parentPrefWindow.setAttribute(
        "ondialogcancel",
        "gCategoriesPane.panelOnCancel(); " + existingOnDialogCancel
      );
    }

    // A list of preferences to be reverted when the dialog is cancelled.
    // It needs to be a property of the parent to be visible onCancel
    if (!("backupPrefList" in parent)) {
      parent.backupPrefList = [];
    }

    gCategoryList = cal.category.fromPrefs();

    this.updateCategoryList();

    this.mCategoryDialog = "chrome://calendar/content/preferences/editCategory.xul";

    // Workaround for Bug 1151440 - the HTML color picker won't work
    // in linux when opened from modal dialog
    this.mWinProp = "centerscreen, chrome, resizable=no";
    if (AppConstants.platform != "linux") {
      this.mWinProp += ", modal";
    }
  },

  /**
   * Updates the listbox containing the categories from the categories saved
   * in preferences.
   */

  updatePrefs: function() {
    cal.l10n.sortArrayByLocaleCollator(gCategoryList);
    Preferences.get("calendar.categories.names").value = cal.category.arrayToString(gCategoryList);
  },

  updateCategoryList: function() {
    this.updatePrefs();
    let listbox = document.getElementById("categorieslist");

    listbox.clearSelection();
    this.updateButtons();

    while (listbox.lastElementChild) {
      listbox.lastChild.remove();
    }

    for (let i = 0; i < gCategoryList.length; i++) {
      let newListItem = document.createXULElement("richlistitem");
      let categoryName = document.createXULElement("label");
      categoryName.setAttribute("id", gCategoryList[i]);
      categoryName.setAttribute("flex", "1");
      categoryName.setAttribute("value", gCategoryList[i]);
      let categoryNameFix = cal.view.formatStringForCSSRule(gCategoryList[i]);

      let categoryColor = document.createXULElement("box");
      categoryColor.setAttribute("width", "150");
      try {
        let colorCode = categoryPrefBranch.getCharPref(categoryNameFix);
        categoryColor.setAttribute("id", colorCode);
        categoryColor.setAttribute("style", "background-color: " + colorCode + ";");
      } catch (ex) {
        categoryColor.setAttribute("label", noneLabel);
      }

      newListItem.appendChild(categoryName);
      newListItem.appendChild(categoryColor);
      listbox.appendChild(newListItem);
    }
  },

  /**
   * Adds a category, opening the edit category dialog to prompt the user to
   * set up the category.
   */
  addCategory: function() {
    let listbox = document.getElementById("categorieslist");
    listbox.clearSelection();
    this.updateButtons();
    let params = {
      title: newTitle,
      category: "",
      color: null,
    };
    gSubDialog.open(this.mCategoryDialog, "resizable=no", params);
  },

  /**
   * Edits the currently selected category using the edit category dialog.
   */
  editCategory: function() {
    let list = document.getElementById("categorieslist");
    let categoryNameFix = cal.view.formatStringForCSSRule(gCategoryList[list.selectedIndex]);
    let currentColor = categoryPrefBranch.getCharPref(categoryNameFix, "");

    let params = {
      title: editTitle,
      category: gCategoryList[list.selectedIndex],
      color: currentColor,
    };
    if (list.selectedItem) {
      gSubDialog.open(this.mCategoryDialog, "resizable=no", params);
    }
  },

  /**
   * Removes the selected category.
   */
  deleteCategory: function() {
    let list = document.getElementById("categorieslist");
    if (list.selectedCount < 1) {
      return;
    }

    let categoryNameFix = cal.view.formatStringForCSSRule(gCategoryList[list.selectedIndex]);
    this.backupData(categoryNameFix);
    try {
      categoryPrefBranch.clearUserPref(categoryNameFix);
    } catch (ex) {
      // If the pref doesn't exist, don't bail out here.
    }

    // Remove category entry from listbox and gCategoryList.
    let newSelection =
      list.selectedItem.nextElementSibling || list.selectedItem.previousElementSibling;
    let selectedItems = Array.from(list.selectedItems);
    for (let i = list.selectedCount - 1; i >= 0; i--) {
      let item = selectedItems[i];
      if (item == newSelection) {
        newSelection = newSelection.nextElementSibling || newSelection.previousElementSibling;
      }
      gCategoryList.splice(list.getIndexOfItem(item), 1);
      item.remove();
    }
    list.selectedItem = newSelection;
    this.updateButtons();

    // Update the prefs from gCategoryList
    this.updatePrefs();
  },

  /**
   * Saves the given category to the preferences.
   *
   * @param categoryName      The name of the category.
   * @param categoryColor     The color of the category
   */
  saveCategory: function(categoryName, categoryColor) {
    let list = document.getElementById("categorieslist");
    // Check to make sure another category doesn't have the same name
    let toBeDeleted = -1;
    for (let i = 0; i < gCategoryList.length; i++) {
      if (i == list.selectedIndex) {
        continue;
      }

      if (categoryName.toLowerCase() == gCategoryList[i].toLowerCase()) {
        if (Services.prompt.confirm(null, overwriteTitle, overwrite)) {
          if (list.selectedIndex != -1) {
            // Don't delete the old category yet. It will mess up indices.
            toBeDeleted = list.selectedIndex;
          }
          list.selectedIndex = i;
        } else {
          return;
        }
      }
    }

    if (categoryName.length == 0) {
      Services.prompt.alert(null, null, noBlankCategories);
      return;
    }

    let categoryNameFix = cal.view.formatStringForCSSRule(categoryName);
    if (list.selectedIndex == -1) {
      this.backupData(categoryNameFix);
      gCategoryList.push(categoryName);
      if (categoryColor) {
        categoryPrefBranch.setCharPref(categoryNameFix, categoryColor);
      }
    } else {
      this.backupData(categoryNameFix);
      gCategoryList.splice(list.selectedIndex, 1, categoryName);
      if (categoryColor) {
        categoryPrefBranch.setCharPref(categoryNameFix, categoryColor);
      } else {
        try {
          categoryPrefBranch.clearUserPref(categoryNameFix);
        } catch (ex) {
          dump("Exception caught in 'saveCategory': " + ex + "\n");
        }
      }
    }

    // If 'Overwrite' was chosen, delete category that was being edited
    if (toBeDeleted != -1) {
      list.selectedIndex = toBeDeleted;
      this.deleteCategory();
    }

    this.updateCategoryList();

    let updatedCategory = gCategoryList.indexOf(categoryName);
    list.ensureIndexIsVisible(updatedCategory);
    list.selectedIndex = updatedCategory;
  },

  /**
   * Enable the edit and delete category buttons.
   */
  updateButtons: function() {
    let categoriesList = document.getElementById("categorieslist");
    document.getElementById("deleteCButton").disabled = categoriesList.selectedCount <= 0;
    document.getElementById("editCButton").disabled = categoriesList.selectedCount != 1;
  },

  /**
   * Backs up the category name in case the dialog is canceled.
   *
   * @see formatStringForCSSRule
   * @param categoryNameFix     The formatted category name.
   */
  backupData: function(categoryNameFix) {
    let currentColor = categoryPrefBranch.getCharPref(categoryNameFix, "##NEW");

    for (let i = 0; i < parent.backupPrefList.length; i++) {
      if (categoryNameFix == parent.backupPrefList[i].name) {
        return;
      }
    }
    parent.backupPrefList[parent.backupPrefList.length] = {
      name: categoryNameFix,
      color: currentColor,
    };
  },

  /**
   * Event Handler function to be called on doubleclick of the categories
   * list. If the edit function is enabled and the user doubleclicked on a
   * list item, then edit the selected category.
   */
  listOnDblClick: function(event) {
    if (event.target.localName == "listitem" && !document.getElementById("editCButton").disabled) {
      this.editCategory();
    }
  },

  /**
   * Reverts category preferences in case the cancel button is pressed.
   */
  panelOnCancel: function() {
    for (let i = 0; i < parent.backupPrefList.length; i++) {
      if (parent.backupPrefList[i].color == "##NEW") {
        try {
          categoryPrefBranch.clearUserPref(parent.backupPrefList[i].name);
        } catch (ex) {
          dump("Exception caught in 'panelOnCancel': " + ex + "\n");
        }
      } else {
        categoryPrefBranch.setCharPref(
          parent.backupPrefList[i].name,
          parent.backupPrefList[i].color
        );
      }
    }
  },
};
