/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = ["AddrBookCard"];

ChromeUtils.defineModuleGetter(
  this,
  "MailServices",
  "resource:///modules/MailServices.jsm"
);
ChromeUtils.defineModuleGetter(
  this,
  "newUID",
  "resource:///modules/AddrBookUtils.jsm"
);

/**
 * Prototype for nsIAbCard objects that are not mailing lists.
 *
 * @implements {nsIAbItem}
 * @implements {nsIAbCard}
 */
function AddrBookCard() {
  this._directoryId = "";
  this._localId = "";
  this._properties = new Map([
    ["PreferMailFormat", Ci.nsIAbPreferMailFormat.unknown],
    ["PopularityIndex", 0],
    ["LastModifiedDate", 0],
  ]);
}

AddrBookCard.prototype = {
  QueryInterface: ChromeUtils.generateQI([Ci.nsIAbCard]),
  classID: Components.ID("{1143991d-31cd-4ea6-9c97-c587d990d724}"),

  /* nsIAbItem */

  get uuid() {
    return MailServices.ab.generateUUID(this._directoryId, this._localId);
  },
  generateName(generateFormat, bundle) {
    let result = "";
    let format;
    switch (generateFormat) {
      case Ci.nsIAbItem.GENERATE_DISPLAY_NAME:
        result = this.displayName;
        break;
      case Ci.nsIAbItem.GENERATE_LAST_FIRST_ORDER:
        format = bundle
          ? bundle.GetStringFromName("lastFirstFormat")
          : "%S, %S";
        result = format
          .replace("%S", this.lastName)
          .replace("%S", this.firstName);
        break;
      case Ci.nsIAbItem.GENERATE_FIRST_LAST_ORDER:
        format = bundle ? bundle.GetStringFromName("firstLastFormat") : "%S %S";
        result = format
          .replace("%S", this.firstName)
          .replace("%S", this.lastName);
        break;
    }

    if (result == "") {
      result = this.getProperty("Company", "");
    }
    if (result == "") {
      result = this.primaryEmail.split("@", 1)[0];
    }

    return result;
  },

  /* nsIAbCard */

  get directoryId() {
    return this._directoryId;
  },
  set directoryId(value) {
    return (this._directoryId = value);
  },
  get localId() {
    return this._localId;
  },
  set localId(value) {
    return (this._localId = value);
  },
  get UID() {
    if (!this._uid) {
      this._uid = newUID();
    }
    return this._uid;
  },
  set UID(value) {
    if (value != this._uid) {
      throw Cr.NS_ERROR_FAILURE;
    }
    return value;
  },
  get properties() {
    let entries = [...this._properties.entries()];
    let enumerator = {
      hasMoreElements() {
        return entries.length > 0;
      },
      getNext() {
        if (!this.hasMoreElements()) {
          throw Cr.NS_ERROR_NOT_AVAILABLE;
        }
        let [name, value] = entries.shift();
        return {
          get name() {
            return name;
          },
          get value() {
            return value;
          },
          QueryInterface: ChromeUtils.generateQI([Ci.nsIProperty]),
        };
      },
      *[Symbol.iterator]() {
        while (this.hasMoreElements()) {
          yield this.getNext();
        }
      },
      QueryInterface: ChromeUtils.generateQI([Ci.nsISimpleEnumerator]),
    };
    return enumerator;
  },
  get firstName() {
    return this.getProperty("FirstName", "");
  },
  set firstName(value) {
    this.setProperty("FirstName", value);
  },
  get lastName() {
    return this.getProperty("LastName", "");
  },
  set lastName(value) {
    this.setProperty("LastName", value);
  },
  get displayName() {
    return this.getProperty("DisplayName", "");
  },
  set displayName(value) {
    this.setProperty("DisplayName", value);
  },
  get primaryEmail() {
    return this.getProperty("PrimaryEmail", "");
  },
  set primaryEmail(value) {
    this.setProperty("PrimaryEmail", value);
  },
  get isMailList() {
    return false;
  },
  get mailListURI() {
    return "";
  },

  getProperty(name, defaultValue) {
    if (this._properties.has(name)) {
      return this._properties.get(name);
    }
    return defaultValue;
  },
  getPropertyAsAString(name) {
    if (!this._properties.has(name)) {
      return "";
    }
    return this.getProperty(name);
  },
  getPropertyAsAUTF8String(name) {
    if (!this._properties.has(name)) {
      throw Cr.NS_ERROR_NOT_AVAILABLE;
    }
    return this.getProperty(name);
  },
  getPropertyAsUint32(name) {
    let value = this.getProperty(name);
    if (isNaN(parseInt(value, 10))) {
      throw Cr.NS_ERROR_NOT_AVAILABLE;
    }
    return value;
  },
  getPropertyAsBool(name) {
    let value = this.getProperty(name);
    switch (value) {
      case false:
      case 0:
      case "0":
        return false;
      case true:
      case 1:
      case "1":
        return true;
    }
    throw Cr.NS_ERROR_NOT_AVAILABLE;
  },
  setProperty(name, value) {
    this._properties.set(name, value);
  },
  setPropertyAsAString(name, value) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  setPropertyAsAUTF8String(name, value) {
    this.setProperty(name, value);
  },
  setPropertyAsUint32(name, value) {
    this.setProperty(name, value);
  },
  setPropertyAsBool(name, value) {
    this.setProperty(name, value ? 1 : 0);
  },
  deleteProperty(name) {
    this._properties.delete(name);
  },
  hasEmailAddress(emailAddress) {
    if (this._properties.get("PrimaryEmail") == emailAddress) {
      return true;
    }
    if (this._properties.get("SecondEmail") == emailAddress) {
      return true;
    }
    return false;
  },
  translateTo(type) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  generatePhoneticName(lastNameFirst) {
    if (lastNameFirst) {
      return `${this.lastName}, ${this.firstName}`;
    }
    return `${this.firstName} ${this.lastName}`;
  },
  generateChatName() {
    for (let name of [
      "_GoogleTalk",
      "_AimScreenName",
      "_Yahoo",
      "_Skype",
      "_QQ",
      "_MSN",
      "_ICQ",
      "_JabberId",
      "_IRC",
    ]) {
      if (this._properties.has(name)) {
        return this._properties.get(name);
      }
    }
    return "";
  },
  copy(srcCard) {
    throw Cr.NS_ERROR_NOT_IMPLEMENTED;
  },
  equals(card) {
    return this.UID == card.UID;
  },
};
