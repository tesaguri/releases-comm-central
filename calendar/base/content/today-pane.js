/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from ../../lightning/content/messenger-overlay-sidebar.js */
/* import-globals-from agenda-listbox-utils.js */
/* import-globals-from calendar-chrome-startup.js */
/* import-globals-from calendar-views-utils.js */

var { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm");

/**
 * Namespace object to hold functions related to the today pane.
 */
var TodayPane = {
  paneViews: null,
  start: null,
  cwlabel: null,
  previousMode: null,
  switchCounter: 0,
  minidayTimer: null,
  minidayDrag: {
    startX: 0,
    startY: 0,
    distance: 0,
    session: false,
  },

  /**
   * Load Handler, sets up the today pane controls.
   */
  onLoad: async function() {
    await agendaListbox.init();

    TodayPane.paneViews = [
      cal.l10n.getCalString("eventsandtasks"),
      cal.l10n.getCalString("tasksonly"),
      cal.l10n.getCalString("eventsonly"),
    ];

    TodayPane.setShortWeekdays();
    TodayPane.updateDisplay();
    TodayPane.updateSplitterState();
    TodayPane.previousMode = gCurrentMode;
    TodayPane.showTodayPaneStatusLabel();

    document.getElementById("today-splitter").addEventListener("command", () => {
      document.dispatchEvent(new CustomEvent("viewresize", { bubbles: true }));
    });

    Services.obs.addObserver(TodayPane, "defaultTimezoneChanged");
  },

  /**
   * Unload handler, cleans up the today pane on window unload.
   */
  onUnload: function() {
    Services.obs.removeObserver(TodayPane, "defaultTimezoneChanged");
  },

  /**
   * React if the default timezone changes.
   */
  observe: function() {
    if (this.start !== null) {
      this.setDay(this.start.getInTimezone(cal.dtz.defaultTimezone));
    }
  },

  /**
   * Sets up the label for the switcher that allows switching between today pane
   * views. (event+task, task only, event only)
   */
  updateDisplay: function() {
    let agendaIsVisible = document.getElementById("agenda-panel").isVisible(gCurrentMode);
    let todoIsVisible = document.getElementById("todo-tab-panel").isVisible(gCurrentMode);
    let index = 2;
    if (agendaIsVisible && todoIsVisible) {
      index = 0;
    } else if (!agendaIsVisible && todoIsVisible) {
      index = 1;
    } else if (agendaIsVisible && !todoIsVisible) {
      index = 2;
    } else {
      // agendaIsVisible == false && todoIsVisible == false:
      // In this case something must have gone wrong
      // - probably in the previous session - and no pane is displayed.
      // We set a default by only displaying agenda-pane.
      agendaIsVisible = true;
      document.getElementById("agenda-panel").setVisible(agendaIsVisible);
      index = 2;
    }
    let todayHeader = document.getElementById("today-pane-header");
    todayHeader.setAttribute("index", index);
    todayHeader.setAttribute("value", this.paneViews[index]);
    let todayPaneSplitter = document.getElementById("today-pane-splitter");
    setBooleanAttribute(todayPaneSplitter, "hidden", index != 0);
    let todayIsVisible = document.getElementById("today-pane-panel").isVisible();

    // Disable or enable the today pane menuitems that have an attribute
    // name="minidisplay" depending on the visibility of elements.
    let menu = document.getElementById("ltnTodayPaneMenuPopup");
    if (menu) {
      setAttributeToChildren(
        menu,
        "disabled",
        !todayIsVisible || !agendaIsVisible,
        "name",
        "minidisplay"
      );
    }

    if (todayIsVisible) {
      if (agendaIsVisible) {
        if (this.start === null) {
          this.setDay(cal.dtz.now());
        }
        if (document.getElementById("today-minimonth-box").isVisible()) {
          document.getElementById("today-minimonth").setAttribute("freebusy", "true");
        }
      }
      if (todoIsVisible) {
        // Add listener to update the date filters.
        getViewDeck().addEventListener("dayselect", event => {
          this.updateCalendarToDoUnifinder();
        });
        this.updateCalendarToDoUnifinder();
      }
    }

    document.dispatchEvent(new CustomEvent("viewresize", { bubbles: true }));
  },

  /**
   * Updates the applied filter and show completed view of the unifinder todo.
   *
   * @param {String} [filter] - The filter name to set.
   */
  updateCalendarToDoUnifinder: function(filter) {
    let tree = document.getElementById("unifinder-todo-tree");

    // Set up hiding completed tasks for the unifinder-todo tree
    filter = filter || tree.getAttribute("filterValue") || "throughcurrent";
    tree.setAttribute("filterValue", filter);

    document
      .querySelectorAll('menuitem[command="calendar_task_filter_todaypane_command"][type="radio"]')
      .forEach(item => {
        if (item.getAttribute("value") == filter) {
          item.setAttribute("checked", "true");
        } else {
          item.removeAttribute("checked");
        }
      });

    let showCompleted = document.getElementById("show-completed-checkbox").checked;
    if (!showCompleted) {
      let filterProps = tree.mFilter.getDefinedFilterProperties(filter);
      if (filterProps) {
        filterProps.status =
          (filterProps.status || filterProps.FILTER_STATUS_ALL) &
          (filterProps.FILTER_STATUS_INCOMPLETE | filterProps.FILTER_STATUS_IN_PROGRESS);
        filter = filterProps;
      }
    }

    // update the filter
    tree.showCompleted = showCompleted;
    tree.updateFilter(filter);
  },

  /**
   * Go to month/week/day views when double-clicking a label inside miniday
   */
  onDoubleClick: function(aEvent) {
    if (aEvent.button == 0) {
      if (aEvent.target.id == "datevalue-label") {
        switchCalendarView("day", true);
      } else if (aEvent.target.parentNode.id == "weekdayNameContainer") {
        switchCalendarView("day", true);
      } else if (aEvent.target.id == "currentWeek-label") {
        switchCalendarView("week", true);
      } else if (aEvent.target.parentNode.id == "monthNameContainer") {
        switchCalendarView("month", true);
      } else {
        return;
      }
      let title = document.getElementById("calendar-tab-button").getAttribute("tooltiptext");
      document.getElementById("tabmail").openTab("calendar", { title: title });
      currentView().goToDay(agendaListbox.today.start);
    }
  },

  /**
   * Set conditions about start dragging on day-label or start switching
   * with time on navigation buttons.
   */
  onMousedown: function(aEvent, aDir) {
    if (aEvent.button != 0) {
      return;
    }
    let element = aEvent.target;
    if (element.id == "previous-day-button" || element.id == "next-day-button") {
      // Start switching days by pressing, without release, the navigation buttons
      element.addEventListener("mouseout", TodayPane.stopSwitching);
      element.addEventListener("mouseup", TodayPane.stopSwitching);
      TodayPane.minidayTimer = setTimeout(
        TodayPane.updateAdvanceTimer.bind(TodayPane, Event, aDir),
        500
      );
    } else if (element.id == "datevalue-label") {
      // Start switching days by dragging the mouse with a starting point on the day label
      window.addEventListener("mousemove", TodayPane.onMousemove);
      window.addEventListener("mouseup", TodayPane.stopSwitching);
      TodayPane.minidayDrag.startX = aEvent.clientX;
      TodayPane.minidayDrag.startY = aEvent.clientY;
    }
  },

  /**
   * Figure out the mouse distance from the center of the day's label
   * to the current position.
   *
   * NOTE: This function is usually called without the correct this pointer.
   */
  onMousemove: function(aEvent) {
    const MIN_DRAG_DISTANCE_SQ = 49;
    let x = aEvent.clientX - TodayPane.minidayDrag.startX;
    let y = aEvent.clientY - TodayPane.minidayDrag.startY;
    if (TodayPane.minidayDrag.session) {
      if (x * x + y * y >= MIN_DRAG_DISTANCE_SQ) {
        let distance = Math.floor(Math.sqrt(x * x + y * y) - Math.sqrt(MIN_DRAG_DISTANCE_SQ));
        // Dragging on the left/right side, the day date decrease/increase
        TodayPane.minidayDrag.distance = x > 0 ? distance : -distance;
      } else {
        TodayPane.minidayDrag.distance = 0;
      }
    } else if (x * x + y * y > 9) {
      // move the mouse a bit before starting the drag session
      window.addEventListener("mouseout", TodayPane.stopSwitching);
      TodayPane.minidayDrag.session = true;
      let dragCenterImage = document.getElementById("dragCenter-image");
      dragCenterImage.removeAttribute("hidden");
      // Move the starting point in the center so we have a fixed
      // point where stopping the day switching while still dragging
      let centerObj = dragCenterImage.getBoundingClientRect();
      TodayPane.minidayDrag.startX = Math.floor(centerObj.x + centerObj.width / 2);
      TodayPane.minidayDrag.startY = Math.floor(centerObj.y + centerObj.height / 2);

      TodayPane.updateAdvanceTimer();
    }
  },

  /**
   * Figure out the days switching speed according to the position (when
   * dragging) or time elapsed (when pressing buttons).
   */
  updateAdvanceTimer: function(aEvent, aDir) {
    const INITIAL_TIME = 400;
    const REL_DISTANCE = 8;
    const MINIMUM_TIME = 100;
    const ACCELERATE_COUNT_LIMIT = 7;
    const SECOND_STEP_TIME = 200;
    if (TodayPane.minidayDrag.session) {
      // Dragging the day label: days switch with cursor distance and time.
      let dir = (TodayPane.minidayDrag.distance > 0) - (TodayPane.minidayDrag.distance < 0);
      TodayPane.advance(dir);
      let distance = Math.abs(TodayPane.minidayDrag.distance);
      // Linear relation between distance and switching speed
      let timeInterval = Math.max(Math.ceil(INITIAL_TIME - distance * REL_DISTANCE), MINIMUM_TIME);
      TodayPane.minidayTimer = setTimeout(
        TodayPane.updateAdvanceTimer.bind(TodayPane, null, null),
        timeInterval
      );
    } else {
      // Keeping pressed next/previous day buttons causes days switching (with
      // three levels higher speed after some commutations).
      TodayPane.advance(parseInt(aDir, 10));
      TodayPane.switchCounter++;
      let timeInterval = INITIAL_TIME;
      if (TodayPane.switchCounter > 2 * ACCELERATE_COUNT_LIMIT) {
        timeInterval = MINIMUM_TIME;
      } else if (TodayPane.switchCounter > ACCELERATE_COUNT_LIMIT) {
        timeInterval = SECOND_STEP_TIME;
      }
      TodayPane.minidayTimer = setTimeout(
        TodayPane.updateAdvanceTimer.bind(TodayPane, aEvent, aDir),
        timeInterval
      );
    }
  },

  /**
   * Stop automatic days switching when releasing the mouse button or the
   * position is outside the window.
   *
   * NOTE: This function is usually called without the correct this pointer.
   */
  stopSwitching: function(aEvent) {
    let element = aEvent.target;
    if (
      TodayPane.minidayDrag.session &&
      aEvent.type == "mouseout" &&
      element.id != "messengerWindow"
    ) {
      return;
    }
    if (TodayPane.minidayTimer) {
      clearTimeout(TodayPane.minidayTimer);
      delete TodayPane.minidayTimer;
      if (TodayPane.switchCounter == 0 && !TodayPane.minidayDrag.session) {
        let dir = element.getAttribute("dir");
        TodayPane.advance(parseInt(dir, 10));
      }
    }
    if (element.id == "previous-day-button" || element.id == "next-day-button") {
      TodayPane.switchCounter = 0;
      let button = document.getElementById(element.id);
      button.removeEventListener("mouseout", TodayPane.stopSwitching);
    }
    if (TodayPane.minidayDrag.session) {
      window.removeEventListener("mouseout", TodayPane.stopSwitching);
      TodayPane.minidayDrag.distance = 0;
      document.getElementById("dragCenter-image").setAttribute("hidden", "true");
      TodayPane.minidayDrag.session = false;
    }
    window.removeEventListener("mousemove", TodayPane.onMousemove);
    window.removeEventListener("mouseup", TodayPane.stopSwitching);
  },

  /**
   * Cycle the view shown in the today pane (event+task, event, task).
   *
   * @param aCycleForward     If true, the views are cycled in the forward
   *                            direction, otherwise in the opposite direction
   */
  cyclePaneView: function(aCycleForward) {
    if (this.paneViews == null) {
      return;
    }
    let index = parseInt(document.getElementById("today-pane-header").getAttribute("index"), 10);
    index = index + aCycleForward;
    let nViewLen = this.paneViews.length;
    if (index >= nViewLen) {
      index = 0;
    } else if (index == -1) {
      index = nViewLen - 1;
    }
    let agendaPanel = document.getElementById("agenda-panel");
    let todoPanel = document.getElementById("todo-tab-panel");
    let isTodoPanelVisible = index != 2 && todoPanel.isVisibleInMode(gCurrentMode);
    let isAgendaPanelVisible = index != 1 && agendaPanel.isVisibleInMode(gCurrentMode);
    todoPanel.setVisible(isTodoPanelVisible);
    agendaPanel.setVisible(isAgendaPanelVisible);
    this.updateDisplay();
  },

  /**
   * Shows short weekday names in the weekdayNameContainer
   */
  setShortWeekdays: function() {
    let weekdisplaydeck = document.getElementById("weekdayNameContainer");
    let children = weekdisplaydeck.children;

    for (let i = 0; i < children.length; i++) {
      children[i].setAttribute("value", cal.l10n.getDateFmtString(`day.${i + 1}.Mmm`));
    }
  },

  /**
   * Sets the shown date from a JSDate.
   *
   * @param aNewDate      The date to show.
   */
  setDaywithjsDate: function(aNewDate) {
    let newdatetime = cal.dtz.jsDateToDateTime(aNewDate, cal.dtz.floating);
    newdatetime = newdatetime.getInTimezone(cal.dtz.defaultTimezone);
    this.setDay(newdatetime, true);
  },

  /**
   * Sets the first day shown in the today pane.
   *
   * @param aNewDate                  The calIDateTime to set.
   * @param aDontUpdateMinimonth      If true, the minimonth will not be
   *                                    updated to show the same date.
   */
  setDay: function(aNewDate, aDontUpdateMinimonth) {
    if (this.setDay.alreadySettingDay) {
      // If we update the mini-month, this function gets called again.
      return;
    }
    if (!document.getElementById("agenda-panel").isVisible()) {
      // If the agenda panel isn't visible, there's no need to set the day.
      return;
    }
    this.setDay.alreadySettingDay = true;
    this.start = aNewDate.clone();

    let daylabel = document.getElementById("datevalue-label");
    daylabel.value = this.start.day;

    // Wait until after the initialisation of #weekdayNameContainer,
    // to avoid its selectedIndex being reset to the wrong value.
    setTimeout(() => {
      let weekdaylabel = document.getElementById("weekdayNameContainer");
      weekdaylabel.selectedIndex = this.start.weekday;
    }, 0);

    let monthnamelabel = document.getElementById("monthNameContainer");
    monthnamelabel.value =
      cal.getDateFormatter().shortMonthName(this.start.month) + " " + this.start.year;

    let currentweeklabel = document.getElementById("currentWeek-label");
    currentweeklabel.value =
      cal.l10n.getCalString("shortcalendarweek") +
      " " +
      cal.getWeekInfoService().getWeekTitle(this.start);

    if (!aDontUpdateMinimonth) {
      try {
        // The minimonth code sometimes throws an exception as a result of this call. Bug 1560547.
        // As there's no known plausible explanation, just catch the exception and carry on.
        document.getElementById("today-minimonth").value = cal.dtz.dateTimeToJsDate(this.start);
      } catch (ex) {
        Cu.reportError(ex);
      }
    }
    this.updatePeriod();
    this.setDay.alreadySettingDay = false;
  },

  /**
   * Advance by a given number of days in the today pane.
   *
   * @param aDir      The number of days to advance. Negative numbers advance
   *                    backwards in time.
   */
  advance: function(aDir) {
    if (aDir != 0) {
      this.start.day += aDir;
      this.setDay(this.start);
    }
  },

  /**
   * Checks if the today pane is showing today's date.
   */
  showsToday: function() {
    return cal.dtz.sameDay(cal.dtz.now(), this.start);
  },

  /**
   * Update the period headers in the agenda listbox using the today pane's
   * start date.
   */
  updatePeriod: function() {
    agendaListbox.refreshPeriodDates(this.start.clone());
    if (document.getElementById("todo-tab-panel").isVisible()) {
      this.updateCalendarToDoUnifinder();
    }
  },

  /**
   * Display a certain section in the minday/minimonth part of the todaypane.
   *
   * @param aSection      The section to display
   */
  displayMiniSection: function(aSection) {
    document.getElementById("today-minimonth-box").setVisible(aSection == "minimonth");
    document.getElementById("mini-day-box").setVisible(aSection == "miniday");
    document.getElementById("today-none-box").setVisible(aSection == "none");
    setBooleanAttribute(
      document.getElementById("today-minimonth"),
      "freebusy",
      aSection == "minimonth"
    );
  },

  /**
   * Handler function to update the today-pane when the current mode changes.
   */
  onModeModified: function() {
    let todayPanePanel = document.getElementById("today-pane-panel");
    // Store the previous mode panel's width.
    todayPanePanel.setModeAttribute("modewidths", todayPanePanel.width, TodayPane.previousMode);

    TodayPane.updateDisplay();
    TodayPane.updateSplitterState();
    todayPanePanel.width = todayPanePanel.getModeAttribute("modewidths");
    TodayPane.previousMode = gCurrentMode;
  },

  get isVisible() {
    return document.getElementById("today-pane-panel").isVisible();
  },

  /**
   * Toggle the today-pane and update its visual appearance.
   *
   * @param aEvent        The DOM event occurring on activated command.
   */
  toggleVisibility: function(aEvent) {
    document.getElementById("today-pane-panel").togglePane(aEvent);
    TodayPane.updateDisplay();
    TodayPane.updateSplitterState();
  },

  /**
   * Update the today-splitter state.
   */
  updateSplitterState: function() {
    let splitter = document.getElementById("today-splitter");
    if (this.isVisible) {
      splitter.removeAttribute("hidden");
      splitter.setAttribute("state", "open");
    } else {
      splitter.setAttribute("hidden", "true");
    }
  },

  /**
   * Generates the todaypane toggle command when the today-splitter
   * is being collapsed or uncollapsed.
   */
  onCommandTodaySplitter: function() {
    let todaypane = document.getElementById("today-pane-panel");
    let splitter = document.getElementById("today-splitter");
    let splitterCollapsed = splitter.getAttribute("state") == "collapsed";

    if (splitterCollapsed == todaypane.isVisible()) {
      document.getElementById("calendar_toggle_todaypane_command").doCommand();
    }
  },

  /**
   * Checks if the todayPaneStatusLabel should be hidden.
   */
  showTodayPaneStatusLabel: function() {
    let attributeValue =
      Services.prefs.getBoolPref("calendar.view.showTodayPaneStatusLabel", true) && "false";
    setElementValue(
      document.getElementById("calendar-status-todaypane-button"),
      !attributeValue,
      "hideLabel"
    );
  },
};

window.addEventListener("unload", TodayPane.onUnload, { capture: false, once: true });
