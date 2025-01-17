/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

this.EXPORTED_SYMBOLS = [
  "assert_quick_filter_button_enabled",
  "assert_quick_filter_bar_visible",
  "toggle_quick_filter_bar",
  "assert_constraints_expressed",
  "toggle_boolean_constraints",
  "toggle_tag_constraints",
  "toggle_tag_mode",
  "assert_tag_constraints_visible",
  "assert_tag_constraints_checked",
  "toggle_text_constraints",
  "assert_text_constraints_checked",
  "set_filter_text",
  "assert_filter_text",
  "assert_results_label_count",
  "clear_constraints",
];

var fdh = ChromeUtils.import(
  "resource://testing-common/mozmill/FolderDisplayHelpers.jsm"
);
var mc = fdh.mc;
// disable the deferred search processing!
mc.window.QuickFilterBarMuxer.deferredUpdateSearch =
  mc.window.QuickFilterBarMuxer.updateSearch;

/**
 * Maps names to bar DOM ids to simplify checking.
 */
var nameToBarDomId = {
  sticky: "qfb-sticky",
  unread: "qfb-unread",
  starred: "qfb-starred",
  addrbook: "qfb-inaddrbook",
  tags: "qfb-tags",
  attachments: "qfb-attachment",
};

function assert_quick_filter_button_enabled(aEnabled) {
  if (mc.e("qfb-show-filter-bar").disabled == aEnabled) {
    throw new Error(
      "Quick filter bar button should be " + (aEnabled ? "enabled" : "disabled")
    );
  }
}

function assert_quick_filter_bar_visible(aVisible) {
  if (mc.e("quick-filter-bar").getBoundingClientRect().height > 0 != aVisible) {
    throw new Error(
      "Quick filter bar should be " + (aVisible ? "visible" : "collapsed")
    );
  }
}

/**
 * Toggle the state of the message filter bar as if by a mouse click.
 */
function toggle_quick_filter_bar() {
  mc.click(mc.eid("qfb-show-filter-bar"));
  fdh.wait_for_all_messages_to_load();
}

/**
 * Assert that the state of the constraints visually expressed by the bar is
 * consistent with the passed-in constraints.  This method does not verify
 * that the search constraints are in effect.  Check that elsewhere.
 */
function assert_constraints_expressed(aConstraints) {
  for (let name in nameToBarDomId) {
    let domId = nameToBarDomId[name];
    let expectedValue = name in aConstraints ? aConstraints[name] : false;
    let domNode = mc.e(domId);
    if (domNode.checked !== expectedValue) {
      throw new Error(name + "'s checked state should be " + expectedValue);
    }
  }
}

/**
 * Toggle the given filter buttons by name (from nameToBarDomId); variable
 * argument magic enabled.
 */
function toggle_boolean_constraints(...aArgs) {
  aArgs.forEach(arg => mc.click(mc.eid(nameToBarDomId[arg])));
  fdh.wait_for_all_messages_to_load(mc);
}

/**
 * Toggle the tag faceting buttons by tag key.  Wait for messages after.
 */
function toggle_tag_constraints(...aArgs) {
  let qfbButtons = mc.e("quick-filter-bar-tab-bar");
  aArgs.forEach(function(arg) {
    let tagId = "qfb-tag-" + arg;
    qfbButtons.ensureElementIsVisible(mc.e(tagId));
    mc.click(mc.eid(tagId));
  });
  fdh.wait_for_all_messages_to_load(mc);
}

/**
 * Set the tag filtering mode. Wait for messages after.
 */
function toggle_tag_mode() {
  let qbm = mc.e("qfb-boolean-mode");
  if (qbm.value === "AND") {
    qbm.selectedIndex--; // = move to "OR";
    fdh.assert_equals(qbm.value, "OR", "qfb-boolean-mode has wrong state");
  } else if (qbm.value === "OR") {
    qbm.selectedIndex++; // = move to "AND";
    fdh.assert_equals(qbm.value, "AND", "qfb-boolean-mode has wrong state");
  } else {
    throw new Error("qfb-boolean-mode value=" + qbm.value);
  }
  fdh.wait_for_all_messages_to_load(mc);
}

/**
 * Verify that tag buttons exist for exactly the given set of tag keys in the
 *  provided variable argument list.  Ordering is significant.
 */
function assert_tag_constraints_visible(...aArgs) {
  // the stupid bar should be visible if any arguments are specified
  if (aArgs.length > 0 && mc.e("quick-filter-bar-tab-bar").collapsed) {
    throw new Error("The tag bar should not be collapsed!");
  }

  let kids = mc.e("quick-filter-bar-tab-bar").children;
  let tagLength = kids.length - 1; // -1 for the qfb-boolean-mode widget
  // this is bad error reporting in here for now.
  if (tagLength != aArgs.length) {
    throw new Error(
      "Mismatch in expected tag count and actual. " +
        "Expected " +
        aArgs.length +
        " actual " +
        tagLength
    );
  }
  for (let iArg = 0; iArg < aArgs.length; iArg++) {
    let nodeId = "qfb-tag-" + aArgs[iArg];
    if (nodeId != kids[iArg + 1].id) {
      throw new Error(
        "Mismatch at tag " +
          iArg +
          " expected " +
          nodeId +
          " but got " +
          kids[iArg + 1].id
      );
    }
  }
}

/**
 * Verify that only the buttons corresponding to the provided tag keys are
 * checked.
 */
function assert_tag_constraints_checked(...aArgs) {
  let expected = {};
  for (let arg of aArgs) {
    let nodeId = "qfb-tag-" + arg;
    expected[nodeId] = true;
  }

  let kids = mc.e("quick-filter-bar-tab-bar").children;
  for (let iNode = 0; iNode < kids.length; iNode++) {
    let node = kids[iNode];
    if (node.checked != node.id in expected) {
      throw new Error(
        "node " +
          node.id +
          " should " +
          (node.id in expected ? "be " : "not be ") +
          "checked."
      );
    }
  }
}

var nameToTextDomId = {
  sender: "qfb-qs-sender",
  recipients: "qfb-qs-recipients",
  subject: "qfb-qs-subject",
  body: "qfb-qs-body",
};

function toggle_text_constraints(...aArgs) {
  aArgs.forEach(arg => mc.click(mc.eid(nameToTextDomId[arg])));
  fdh.wait_for_all_messages_to_load(mc);
}

/**
 * Assert that the text constraint buttons are checked.  Variable-argument
 *  support where the arguments are one of sender/recipients/subject/body.
 */
function assert_text_constraints_checked(...aArgs) {
  let expected = {};
  for (let arg of aArgs) {
    let nodeId = nameToTextDomId[arg];
    expected[nodeId] = true;
  }

  let kids = mc.e("quick-filter-bar-filter-text-bar").children;
  for (let iNode = 0; iNode < kids.length; iNode++) {
    let node = kids[iNode];
    if (node.tagName == "label") {
      continue;
    }
    if (node.checked != node.id in expected) {
      throw new Error(
        "node " +
          node.id +
          " should " +
          (node.id in expected ? "be " : "not be ") +
          "checked."
      );
    }
  }
}

/**
 * Set the text in the text filter box, trigger it like enter was pressed, then
 *  wait for all messages to load.
 */
function set_filter_text(aText) {
  // We're not testing the reliability of the textbox widget; just poke our text
  // in and trigger the command logic.
  let textbox = mc.e("qfb-qs-textbox");
  textbox.value = aText;
  textbox.doCommand();
  fdh.wait_for_all_messages_to_load(mc);
}

function assert_filter_text(aText) {
  let textbox = mc.e("qfb-qs-textbox");
  if (textbox.value != aText) {
    throw new Error(
      "Expected text filter value of '" + aText + "' but got '" + textbox.value
    );
  }
}

/**
 * Assert that the results label is telling us there are aCount messages
 *  using the appropriate string.
 */
function assert_results_label_count(aCount) {
  let resultsLabel = mc.e("qfb-results-label");
  if (aCount == 0) {
    if (resultsLabel.value != resultsLabel.getAttribute("noresultsstring")) {
      throw new Error(
        "results label should be displaying the no messages case"
      );
    }
  } else {
    let s = resultsLabel.value;
    s = s.substring(0, s.indexOf(" "));
    if (parseInt(s) !== aCount) {
      throw new Error(
        "Result count is displaying " + s + " but should show " + aCount
      );
    }
  }
}

/**
 * Clear active constraints via any means necessary; state cleanup for testing,
 *  not to be used as part of a test.  Unlike normal clearing, this will kill
 *  the sticky bit.
 *
 * This is automatically called by the test teardown helper.
 */
function clear_constraints() {
  mc.window.QuickFilterBarMuxer._testHelperResetFilterState();
}
