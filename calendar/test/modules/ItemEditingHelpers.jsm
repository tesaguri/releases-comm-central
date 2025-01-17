/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

this.EXPORTED_SYMBOLS = [
  "CATEGORY_LIST",
  "REPEAT_DETAILS",
  "EVENT_TABPANELS",
  "DESCRIPTION_TEXTBOX",
  "ATTENDEES_ROW",
  "PERCENT_COMPLETE_INPUT",
  "DATE_INPUT",
  "TIME_INPUT",
  "REC_DLG_ACCEPT",
  "REC_DLG_DAYS",
  "REC_DLG_UNTIL_INPUT",
  "helpersForEditUI",
  "setData",
  "setReminderMenulist",
  "setCategories",
  "handleAddingAttachment",
  "setTimezone",
];

var elementslib = ChromeUtils.import("resource://testing-common/mozmill/elementslib.jsm");

var {
  helpersForController,
  menulistSelect,
  SHORT_SLEEP,
  TIMEOUT_MODAL_DIALOG,
} = ChromeUtils.import("resource://testing-common/mozmill/CalendarUtils.jsm");
var { mark_failure } = ChromeUtils.import(
  "resource://testing-common/mozmill/FolderDisplayHelpers.jsm"
);
var { augment_controller, plan_for_modal_dialog, wait_for_modal_dialog } = ChromeUtils.import(
  "resource://testing-common/mozmill/WindowHelpers.jsm"
);

var { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm");

// Lookup paths and path-snippets.
// These 5 have to be used with itemEditLookup().
var CATEGORY_LIST = `
    id("event-grid")/id("event-grid-category-color-row")/id("event-grid-category-color-td")
    /id("item-categories")/id("item-categories-popup")
`;
var REPEAT_DETAILS = `
    id("event-grid")/id("event-grid-recurrence-row")/id("event-grid-recurrence-td")/id("event-grid-recurrence-picker-box")/
    id("repeat-deck")/id("repeat-details")/[0]
`;
var EVENT_TABPANELS = `
    id("event-grid-tab-vbox")/id("event-grid-tab-box-row")/id("event-grid-tabbox")/
    id("event-grid-tabpanels")
`;
var DESCRIPTION_TEXTBOX = `
    ${EVENT_TABPANELS}/id("event-grid-tabpanel-description")/id("item-description")
`;
var ATTENDEES_ROW = `
    ${EVENT_TABPANELS}/id("event-grid-tabpanel-attendees")/{"flex":"1"}/
    {"flex":"1"}/id("item-attendees-box")/{"class":"item-attendees-row"}
`;
// Only for Tasks.
var PERCENT_COMPLETE_INPUT = `
    id("event-grid")/id("event-grid-todo-status-row")/id("event-grid-todo-status-td")/
    id("event-grid-todo-status-picker-box")/id("percent-complete-textbox")
`;

// To be appended to the path for a date- or timepicker.
var DATE_INPUT = `
    {"class":"datepicker-menulist"}/{"class":"menulist-input"}
`;
var TIME_INPUT = `
    {"class":"timepicker-menulist"}/{"class":"menulist-input"}
`;

// The following can be used as is.
var REC_DLG_ACCEPT = `
    /id("calendar-event-dialog-recurrence")/shadow/
    {"class":"dialog-button-box"}/{"dlgtype":"accept"}
`;
var REC_DLG_DAYS = `
    /id("calendar-event-dialog-recurrence")/id("recurrence-pattern-groupbox")/
    {"flex":"1"}/[1]/id("period-deck")/id("period-deck-weekly-box")/[1]/id("daypicker-weekday")
`;
var REC_DLG_UNTIL_INPUT = `
    /id("calendar-event-dialog-recurrence")/id("recurrence-range-groupbox")/[1]/
    id("recurrence-duration")/id("recurrence-range-until-box")/id("repeat-until-date")/
    anon({"class":"datepicker-menulist"})/{"class":"menulist-input"}
`;

function helpersForEditUI(controller) {
  function selector(sel) {
    return sel.trim().replace(/\n(\s*)/g, "");
  }

  let isEvent = cal.item.isEvent(controller.window.calendarItem);

  let obj = {
    iframeLookup: path => {
      let type = isEvent ? "event" : "task";
      return new elementslib.Lookup(
        controller.window.document,
        selector(`
                /id("calendar-${type}-dialog-inner")/${path}
            `)
      );
    },
    getDateTimePicker: id => {
      let startId = isEvent ? "event-starttime" : "todo-entrydate";
      let endId = isEvent ? "event-endtime" : "todo-duedate";
      let path;
      switch (id) {
        case "STARTDATE":
          path = `
                        id("event-grid")/id("event-grid-startdate-row")/
                        id("event-grid-startdate-td")/id("event-grid-startdate-picker-box")/
                        id("${startId}")/anon({"anonid":"datepicker"})/${DATE_INPUT}
                    `;
          break;
        case "ENDDATE":
          path = `
                        id("event-grid")/id("event-grid-enddate-row")/id("event-grid-enddate-td")/
                        id("event-grid-enddate-vbox")/id("event-grid-enddate-picker-box")/
                        id("${endId}")/anon({"anonid":"datepicker"})/${DATE_INPUT}
                    `;
          break;
        case "STARTTIME":
          path = `
                        id("event-grid")/id("event-grid-startdate-row")/id("event-grid-startdate-td")/
                        id("event-grid-startdate-picker-box")/
                        id("${startId}")/anon({"anonid":"timepicker"})/${TIME_INPUT}
                    `;
          break;
        case "ENDTIME":
          path = `
                        id("event-grid")/id("event-grid-enddate-row")/id("event-grid-enddate-td")/
                        id("event-grid-enddate-vbox")/id("event-grid-enddate-picker-box")/
                        id("${endId}")/anon({"anonid":"timepicker"})/${TIME_INPUT}
                    `;
          break;
        case "UNTILDATE":
          path = `
                        id("event-grid")/id("event-grid-recurrence-row")/
                        id("event-grid-recurrence-td")/
                        id("event-grid-recurrence-picker-box")/id("repeat-deck")/
                        id("repeat-untilDate")/id("repeat-until-datepicker")/
                        ${DATE_INPUT}
                    `;
          break;
        case "COMPLETEDDATE":
          path = `
                        id("event-grid")/id("event-grid-todo-status-row")/
                        id("event-grid-todo-status-td")/
                        id("event-grid-todo-status-picker-box")/id("completed-date-picker")/
                        ${DATE_INPUT}
                    `;
          break;
      }
      return obj.iframeLookup(path);
    },
  };
  return obj;
}

/**
 * Helper function to enter event/task dialog data.
 *
 * @param dialog    event/task dialog controller
 * @param iframe    event/task dialog iframe controller
 * @param data      dataset object
 *                      title - event/task title
 *                      location - event/task location
 *                      description - event/task description
 *                      categories - array of category names
 *                      calendar - Calendar the item should be in.
 *                      allday - boolean value
 *                      startdate - Date object
 *                      starttime - Date object
 *                      enddate - Date object
 *                      endtime - Date object
 *                      timezonedisplay - False for hidden, true for shown.
 *                      timezone - String identifying the Timezone.
 *                      repeat - reccurrence value, one of none/daily/weekly/
 *                               every.weekday/bi.weekly/
 *                               monthly/yearly
 *                               (Custom is not supported.)
 *                      repeatuntil - Date object
 *                      reminder - none/0minutes/5minutes/15minutes/30minutes
 *                                 1hour/2hours/12hours/1day/2days/1week
 *                                 (Custom is not supported.)
 *                      priority - none/low/normal/high
 *                      privacy - public/confidential/private
 *                      status - none/tentative/confirmed/canceled for events
 *                               none/needs-action/in-process/completed/cancelled for tasks
 *                      completed - Date object for tasks
 *                      percent - percent complete for tasks
 *                      freebusy - free/busy
 *                      attachment.add - url to add
 *                      attachment.remove - Label of url to remove. (without http://)
 *                      attendees.add - eMail of attendees to add, comma separated.
 *                      attendees.remove - eMail of attendees to remove, comma separated.
 */
function setData(dialog, iframe, data) {
  let { eid, sleep, replaceText } = helpersForController(dialog);
  let { eid: iframeid } = helpersForController(iframe);
  let { iframeLookup, getDateTimePicker } = helpersForEditUI(iframe);

  let isEvent = cal.item.isEvent(iframe.window.calendarItem);

  let startdateInput = getDateTimePicker("STARTDATE");
  let enddateInput = getDateTimePicker("ENDDATE");
  let starttimeInput = getDateTimePicker("STARTTIME");
  let endtimeInput = getDateTimePicker("ENDTIME");
  let completeddateInput = getDateTimePicker("COMPLETEDDATE");
  let percentCompleteInput = iframeLookup(PERCENT_COMPLETE_INPUT);
  let untilDateInput = getDateTimePicker("UNTILDATE");

  let dateFormatter = cal.getDateFormatter();
  // Wait for input elements' values to be populated.
  sleep();

  // title
  if (data.title != undefined) {
    let titleInput = iframeid("item-title");
    replaceText(titleInput, data.title);
  }

  // location
  if (data.location != undefined) {
    let locationInput = iframeid("item-location");
    replaceText(locationInput, data.location);
  }

  // categories
  if (data.categories != undefined) {
    setCategories(dialog, iframe, data.categories);
  }

  // calendar
  if (data.calendar != undefined) {
    menulistSelect(iframeid("item-calendar"), data.calendar, dialog);
  }

  // all-day
  if (data.allday != undefined && isEvent) {
    dialog.check(iframeid("event-all-day"), data.allday);
  }

  // timezonedisplay
  if (data.timezonedisplay !== undefined) {
    let menuitem = eid("options-timezones-menuitem");
    if (menuitem.getNode().getAttribute("checked") != data.timezonedisplay) {
      dialog.click(menuitem);
    }
  }

  // timezone
  if (data.timezone !== undefined) {
    setTimezone(dialog, data.timezone);
  }

  // startdate
  if (data.startdate != undefined && data.startdate.constructor.name == "Date") {
    let startdate = dateFormatter.formatDateShort(
      cal.dtz.jsDateToDateTime(data.startdate, cal.dtz.floating)
    );

    if (!isEvent) {
      dialog.check(iframeid("todo-has-entrydate"), true);
    }
    replaceText(startdateInput, startdate);
  }

  // starttime
  if (data.starttime != undefined && data.starttime.constructor.name == "Date") {
    let starttime = dateFormatter.formatTime(
      cal.dtz.jsDateToDateTime(data.starttime, cal.dtz.floating)
    );
    replaceText(starttimeInput, starttime);
    sleep();
  }

  // enddate
  if (data.enddate != undefined && data.enddate.constructor.name == "Date") {
    let enddate = dateFormatter.formatDateShort(
      cal.dtz.jsDateToDateTime(data.enddate, cal.dtz.floating)
    );
    if (!isEvent) {
      dialog.check(iframeid("todo-has-duedate"), true);
    }
    replaceText(enddateInput, enddate);
  }

  // endtime
  if (data.endtime != undefined && data.endtime.constructor.name == "Date") {
    let endtime = dateFormatter.formatTime(
      cal.dtz.jsDateToDateTime(data.endtime, cal.dtz.floating)
    );
    replaceText(endtimeInput, endtime);
  }

  // recurrence
  if (data.repeat != undefined) {
    menulistSelect(iframeid("item-repeat"), data.repeat, dialog);
  }
  if (data.repeatuntil != undefined && data.repeatuntil.constructor.name == "Date") {
    // Only fill in date, when the Datepicker is visible.
    if (iframeid("repeat-deck").getNode().selectedIndex == 0) {
      let untildate = dateFormatter.formatDateShort(
        cal.dtz.jsDateToDateTime(data.repeatuntil, cal.dtz.floating)
      );
      replaceText(untilDateInput, untildate);
    }
  }

  // reminder
  if (data.reminder != undefined) {
    setReminderMenulist(dialog, iframeid("item-alarm").getNode(), data.reminder);
  }

  // priority
  if (data.priority != undefined) {
    dialog.mainMenu.click(`#options-priority-${data.priority}-label`);
  }

  // privacy
  if (data.privacy != undefined) {
    dialog.click(eid("button-privacy"));
    let menu = dialog.getMenu("#event-privacy-menupopup");
    menu.click(`#event-privacy-${data.privacy}-menuitem`);
    menu.close();
  }

  // status
  if (data.status != undefined) {
    if (isEvent) {
      dialog.mainMenu.click(`#options-status-${data.status}-menuitem`);
    } else {
      menulistSelect(iframeid("todo-status"), data.status.toUpperCase(), dialog);
    }
  }

  let currentStatus = iframeid("todo-status").getNode().value;

  // completed on
  if (data.completed != undefined && data.completed.constructor.name == "Date" && !isEvent) {
    let completeddate = dateFormatter.formatDateShort(
      cal.dtz.jsDateToDateTime(data.completed, cal.dtz.floating)
    );
    if (currentStatus == "COMPLETED") {
      replaceText(completeddateInput, completeddate);
    }
  }

  // percent complete
  if (
    data.percent != undefined &&
    (currentStatus == "NEEDS-ACTION" ||
      currentStatus == "IN-PROCESS" ||
      currentStatus == "COMPLETED")
  ) {
    replaceText(percentCompleteInput, data.percent);
  }

  // free/busy
  if (data.freebusy != undefined) {
    dialog.mainMenu.click(`#options-freebusy-${data.freebusy}-menuitem`);
  }

  // description
  if (data.description != undefined) {
    dialog.click(iframeid("event-grid-tab-description"));
    let descField = iframeLookup(DESCRIPTION_TEXTBOX);
    replaceText(descField, data.description);
  }

  // attachment
  if (data.attachment != undefined) {
    if (data.attachment.add != undefined) {
      handleAddingAttachment(dialog, data.attachment.add);
    }
    if (data.attachment.remove != undefined) {
      dialog.click(iframeid("event-grid-tab-attachments"));
      let attachmentBox = iframeid("attachment-link");
      let attachments = attachmentBox.getNode().children;
      for (let attachment of attachments) {
        if (attachment.tooltipText.includes(data.attachment.remove)) {
          dialog.click(new elementslib.Elem(attachment));
          dialog.keypress(attachmentBox, "VK_DELETE", {});
        }
      }
    }
  }

  // attendees
  if (data.attendees != undefined) {
    // Display attendees Tab.
    dialog.click(iframeid("event-grid-tab-attendees"));
    // Make sure no notifications are sent, since handling this dialog is
    // not working when deleting a parent of a recurring event.
    let attendeeCheckbox = iframeid("notify-attendees-checkbox");
    if (!attendeeCheckbox.getNode().disabled) {
      dialog.check(attendeeCheckbox, false);
    }

    // add
    if (data.attendees.add != undefined) {
      addAttendees(dialog, iframe, data.attendees.add);
    }
    // delete
    if (data.attendees.remove != undefined) {
      deleteAttendees(dialog, iframe, data.attendees.remove);
    }
  }

  sleep(SHORT_SLEEP);
}

/**
 * Select an item in the reminder menulist.
 * Custom reminders are not supported.
 *
 * @param controller      Mozmill controller of item-Iframe:
 * @param menulist        The reminder menulist node.
 * @param id              Identifying string of menuitem id.
 */
function setReminderMenulist(controller, menulist, id) {
  let { eid } = helpersForController(controller);

  let menuitem = eid(`reminder-${id}-menuitem`);
  menulist.click();
  controller.click(menuitem);
  controller.waitFor(() => {
    return menulist.selectedItem.id == `reminder-${id}-menuitem`;
  });
}

/**
 * Set the categories in the event-dialog menulist-panel.
 *
 * @param dialog      Mozmill controller of event-dialog.
 * @param iframe      Controller of the iframe of the dialog.
 * @param index       Array containing the categories as strings - leave empty to clear.
 */
function setCategories(dialog, iframe, categories) {
  let { eid: iframeid } = helpersForController(iframe);
  let { iframeLookup } = helpersForEditUI(iframe);
  let categoryMenulist = iframeid("item-categories");
  let categoryList = iframeLookup(CATEGORY_LIST);
  dialog.click(categoryMenulist);
  dialog.waitFor(() => categoryMenulist.getNode().open);
  if (categoryMenulist.itemCount > -1 && categoryMenulist.itemCount < categories.length) {
    mark_failure(["more categories than supported by current calendar"]);
  } else {
    // Iterate over categories and check if needed.
    let listItems = categoryList.getNode().children;
    for (let item of listItems) {
      let set = false;
      if (categories.includes(item.label)) {
        set = true;
      }
      if (set && !item.getAttribute("checked")) {
        item.setAttribute("checked", true);
      } else if (!set && item.getAttribute("checked")) {
        item.removeAttribute("checked");
      }
    }
  }
  categoryList.getNode().hidePopup();
  dialog.click(iframeid("item-title"));
  dialog.sleep();
}

/**
 * Add an URL attachment.
 *
 * @param controller        Mozmill window controller
 * @param url               URL to be added
 */
function handleAddingAttachment(controller, url) {
  let { eid } = helpersForController(controller);
  plan_for_modal_dialog("commonDialog", attachment => {
    let { lookup: cdlglookup, eid: cdlgid } = helpersForController(attachment);
    attachment.waitForElement(cdlgid("loginTextbox"));
    cdlgid("loginTextbox").getNode().value = url;
    attachment.click(
      cdlglookup(`
            /id("commonDialog")/shadow/{"class":"dialog-button-box"}/{"dlgtype":"accept"}
        `)
    );
  });
  controller.click(eid("button-url"));

  wait_for_modal_dialog("commonDialog", TIMEOUT_MODAL_DIALOG);
}

/**
 * Add attendees to the event.
 *
 * @param dialog            The controller of the Edit Dialog.
 * @param innerFrame        The controller of the item iframe.
 * @param attendeesString   Comma separated list of eMail-Addresses to add.
 */
function addAttendees(dialog, innerFrame, attendeesString) {
  let { eid: dlgid } = helpersForController(dialog);

  let attendees = attendeesString.split(",");
  for (let attendee of attendees) {
    let calAttendee = innerFrame.window.attendees.find(aAtt => aAtt.id == `mailto:${attendee}`);
    // Only add if not already present.
    if (!calAttendee) {
      plan_for_modal_dialog("Calendar:EventDialog:Attendees", attDialog => {
        let { lookup: attlookup, eid: attid } = helpersForController(attDialog);

        let input = attid("attendees-list");
        // As starting point is always the last entered Attendee, we have
        // to advance to not overwrite it.
        attDialog.waitFor(
          () => attDialog.window.document.activeElement.getAttribute("is") == "autocomplete-input"
        );
        attDialog.keypress(input, "VK_TAB", {});
        attDialog.waitFor(
          () =>
            attDialog.window.document.activeElement.getAttribute("is") == "autocomplete-input" &&
            attDialog.window.document.activeElement.getAttribute("value") == null
        );
        attDialog.type(input, attendee);
        attDialog.click(
          attlookup(`
                    /id("calendar-event-dialog-attendees-v2")/shadow/
                    {"class":"dialog-button-box"}/{"dlgtype":"accept"}
                `)
        );
      });
      dialog.click(dlgid("button-attendees"));
      wait_for_modal_dialog("Calendar:EventDialog:Attendees", TIMEOUT_MODAL_DIALOG);
    }
  }
}

/**
 * Delete attendees from the event.
 *
 * @param dialog            The controller of the Edit Dialog.
 * @param innerFrame        The controller of the item iframe.
 * @param attendeesString   Comma separated list of eMail-Addresses to delete.
 */
function deleteAttendees(event, innerFrame, attendeesString) {
  let { eid: iframeid } = helpersForController(innerFrame);
  let { iframeLookup } = helpersForEditUI(innerFrame);

  // Now delete the attendees.
  let attendees = attendeesString.split(",");
  for (let attendee of attendees) {
    let attendeeToDelete = iframeLookup(`${ATTENDEES_ROW}/{"attendeeid":"mailto:${attendee}"}`);
    if (attendeeToDelete) {
      augment_controller(event);
      event.rightClick(attendeeToDelete);
      event.click_menus_in_sequence(iframeid("attendee-popup").getNode(), [
        { id: "attendee-popup-removeattendee-menuitem" },
      ]);
    }
    event.waitForElementNotPresent(attendeeToDelete);
  }
}

/**
 * Set the timezone for the item
 *
 * @param event           The controller of the Edit Dialog.
 * @param timezone        String identifying the Timezone.
 */
function setTimezone(event, timezone) {
  let { eid: eventid } = helpersForController(event);
  let eventCallback = function(zone, tzcontroller) {
    let { lookup: tzlookup, xpath: tzpath } = helpersForController(tzcontroller);

    let item = tzpath(`
            /*[name()='dialog']/*[name()='menulist'][1]/*[name()='menupopup'][1]/
            *[@value='${zone}']
        `);
    tzcontroller.waitForElement(item);
    tzcontroller.click(item);
    tzcontroller.click(
      tzlookup(`
            /id("calendar-event-dialog-timezone")/shadow/
            {"class":"dialog-button-box"}/{"dlgtype":"accept"}
        `)
    );
  };

  if (eventid("timezone-starttime").getNode().collapsed) {
    let menuitem = eventid("options-timezones-menuitem");
    event.click(menuitem);
  }

  plan_for_modal_dialog("Calendar:EventDialog:Timezone", eventCallback.bind(null, timezone));
  event.waitForElement(eventid("timezone-starttime"));
  event.click(eventid("timezone-starttime"));
  event.click(eventid("timezone-starttime"));
  event.waitForElement(eventid("timezone-custom-menuitem"));
  event.click(eventid("timezone-custom-menuitem"));
  wait_for_modal_dialog("Calendar:EventDialog:Timezone", TIMEOUT_MODAL_DIALOG);
}
