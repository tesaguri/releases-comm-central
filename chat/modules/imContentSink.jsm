/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { Services } = ChromeUtils.import("resource:///modules/imServices.jsm");

this.EXPORTED_SYMBOLS = [
  // cleanImMarkup is used to clean up incoming IMs. It will use the global
  // ruleset of acceptable stuff except if another (custom one) is provided.
  "cleanupImMarkup",
  // createDerivedRuleset is used to create a ruleset that inherits from the
  // default one. Useful if you want to allow or forbid an additional thing in
  // a specific conversation but take into account all the other global
  // settings.
  "createDerivedRuleset",
  "addGlobalAllowedTag",
  "removeGlobalAllowedTag",
  "addGlobalAllowedAttribute",
  "removeGlobalAllowedAttribute",
  "addGlobalAllowedStyleRule",
  "removeGlobalAllowedStyleRule",
];

/*
 * Structure of a ruleset:
 * A ruleset is a JS object containing 3 sub-objects: attrs, tags and styles.
 *  - attrs: an object containing a list of attributes allowed for all tags.
 *      example: attrs: { 'style': true }
 *
 *  - tags: an object with the allowed tags. each tag can allow specific attributes.
 *      example: 'a': {'href': true}
 *
 *    each attribute can have a function returning a boolean indicating if
 *    the attribute is accepted.
 *      example: 'href': aValue => aValue == 'about:blank'
 *
 *  - styles: an object with the allowed CSS style rule.
 *      example: 'font-size': true
 *    FIXME: make this accept functions to filter the CSS values too.
 *
 *  See the 3 examples of rulesets below.
 */

var kAllowedURLs = aValue => /^(https?|ftp|mailto):/.test(aValue);
var kAllowedMozClasses = aClassName =>
  aClassName == "moz-txt-underscore" ||
  aClassName == "moz-txt-tag" ||
  aClassName == "ib-person";
var kAllowedAnchorClasses = aClassName => aClassName == "ib-person";

/* Tags whose content should be fully removed, and reported in the Error Console. */
var kForbiddenTags = {
  script: true,
  style: true,
};

// in strict mode, remove all formatings. Keep only links and line breaks.
var kStrictMode = {
  attrs: {},

  tags: {
    a: {
      title: true,
      href: kAllowedURLs,
      class: kAllowedAnchorClasses,
    },
    br: true,
    p: true,
  },

  styles: {},
};

// standard mode allows basic formattings (bold, italic, underlined)
var kStandardMode = {
  attrs: {
    style: true,
  },

  tags: {
    div: true,
    a: {
      title: true,
      href: kAllowedURLs,
      class: kAllowedAnchorClasses,
    },
    em: true,
    strong: true,
    b: true,
    i: true,
    u: true,
    span: {
      class: kAllowedMozClasses,
    },
    br: true,
    code: true,
    ul: true,
    li: true,
    ol: true,
    cite: true,
    blockquote: true,
    p: true,
  },

  styles: {
    "font-style": true,
    "font-weight": true,
    "text-decoration-line": true,
  },
};

// permissive mode allows about anything that isn't going to mess up the chat window
var kPermissiveMode = {
  attrs: {
    style: true,
  },

  tags: {
    div: true,
    a: {
      title: true,
      href: kAllowedURLs,
      class: kAllowedAnchorClasses,
    },
    font: {
      face: true,
      color: true,
      size: true,
    },
    em: true,
    strong: true,
    b: true,
    i: true,
    u: true,
    span: {
      class: kAllowedMozClasses,
    },
    br: true,
    hr: true,
    code: true,
    ul: true,
    li: true,
    ol: true,
    cite: true,
    blockquote: true,
    p: true,
  },

  // FIXME: should be possible to use functions to filter values
  styles: {
    color: true,
    font: true,
    "font-family": true,
    "font-size": true,
    "font-style": true,
    "font-weight": true,
    "text-decoration-color": true,
    "text-decoration-style": true,
    "text-decoration-line": true,
  },
};

var kModePref = "messenger.options.filterMode";
var kModes = [kStrictMode, kStandardMode, kPermissiveMode];

var gGlobalRuleset = null;

function initGlobalRuleset() {
  gGlobalRuleset = newRuleset();

  Services.prefs.addObserver(kModePref, styleObserver);
}

var styleObserver = {
  observe(aObject, aTopic, aMsg) {
    if (aTopic != "nsPref:changed" || aMsg != kModePref) {
      throw new Error("bad notification");
    }

    if (!gGlobalRuleset) {
      throw new Error("gGlobalRuleset not initialized");
    }

    setBaseRuleset(getModePref(), gGlobalRuleset);
  },
};

function getModePref() {
  let baseNum = Services.prefs.getIntPref(kModePref);
  if (baseNum < 0 || baseNum > 2) {
    baseNum = 1;
  }

  return kModes[baseNum];
}

function setBaseRuleset(aBase, aResult) {
  for (let property in aBase) {
    aResult[property] = Object.create(aBase[property], aResult[property]);
  }
}

function newRuleset(aBase) {
  let result = {
    tags: {},
    attrs: {},
    styles: {},
  };
  setBaseRuleset(aBase || getModePref(), result);
  return result;
}

function createDerivedRuleset() {
  if (!gGlobalRuleset) {
    initGlobalRuleset();
  }
  return newRuleset(gGlobalRuleset);
}

function addGlobalAllowedTag(aTag, aAttrs = true) {
  gGlobalRuleset.tags[aTag] = aAttrs;
}
function removeGlobalAllowedTag(aTag) {
  delete gGlobalRuleset.tags[aTag];
}

function addGlobalAllowedAttribute(aAttr, aRule = true) {
  gGlobalRuleset.attrs[aAttr] = aRule;
}
function removeGlobalAllowedAttribute(aAttr) {
  delete gGlobalRuleset.attrs[aAttr];
}

function addGlobalAllowedStyleRule(aStyle, aRule = true) {
  gGlobalRuleset.styles[aStyle] = aRule;
}
function removeGlobalAllowedStyleRule(aStyle) {
  delete gGlobalRuleset.styles[aStyle];
}

function cleanupNode(aNode, aRules, aTextModifiers) {
  for (let i = 0; i < aNode.children.length; ++i) {
    let node = aNode.children[i];
    if (
      node.nodeType == node.ELEMENT_NODE &&
      node.namespaceURI == "http://www.w3.org/1999/xhtml"
    ) {
      // check if node allowed
      let nodeName = node.localName;
      if (!(nodeName in aRules.tags)) {
        if (nodeName in kForbiddenTags) {
          Cu.reportError(
            "removing a " + nodeName + " tag from a message before display"
          );
        } else {
          // this node is not allowed, replace it with its children
          while (node.hasChildNodes()) {
            aNode.insertBefore(node.firstElementChild, node);
          }
        }
        aNode.removeChild(node);
        // We want to process again the node at the index i which is
        // now the first child of the node we removed
        --i;
        continue;
      }

      // we are going to keep this child node, clean up its children
      cleanupNode(node, aRules, aTextModifiers);

      // cleanup attributes
      let attrs = node.attributes;
      let acceptFunction = function(aAttrRules, aAttr) {
        // an attribute is always accepted if its rule is true, or conditionally
        // accepted if its rule is a function that evaluates to true
        // if its rule does not exist, it is refused
        let localName = aAttr.localName;
        let rule = localName in aAttrRules && aAttrRules[localName];
        return (
          rule === true || (typeof rule == "function" && rule(aAttr.value))
        );
      };
      for (let j = 0; j < attrs.length; ++j) {
        let attr = attrs[j];
        // we check both the list of accepted attributes for all tags
        // and the list of accepted attributes for this specific tag.
        if (
          !(
            acceptFunction(aRules.attrs, attr) ||
            (typeof aRules.tags[nodeName] == "object" &&
              acceptFunction(aRules.tags[nodeName], attr))
          )
        ) {
          node.removeAttribute(attr.name);
          --j;
        }
      }

      // cleanup style
      let style = node.style;
      for (let j = 0; j < style.length; ++j) {
        if (!(style[j] in aRules.styles)) {
          style.removeProperty(style[j]);
          --j;
        }
      }
      // If the removeProperty method wasn't called by the above loop, the
      // style attribute won't be re-generated, so it may still contain
      // unsupported or unparsable CSS. Let's drop "style" attributes that
      // don't contain any supported CSS.
      if (!style.length) {
        node.removeAttribute("style");
      }

      // Sort the style attributes for easier checking/comparing later.
      if (node.hasAttribute("style")) {
        let trailingSemi = false;
        let attrs = node.getAttribute("style").trim();
        if (attrs.endsWith(";")) {
          attrs = attrs.slice(0, -1);
          trailingSemi = true;
        }
        attrs = attrs.split(";").map(a => a.trim());
        attrs.sort();
        node.setAttribute(
          "style",
          attrs.join("; ") + (trailingSemi ? ";" : "")
        );
      }
    } else {
      // We are on a text node, we need to apply the functions
      // provided in the aTextModifiers array.

      // Each of these function should return the number of nodes added:
      //  * -1 if the current textnode was deleted
      //  * 0 if the node count is unchanged
      //  * positive value if nodes were added.
      //     For instance, adding an <img> tag for a smiley adds 2 nodes:
      //      - the img tag
      //      - the new text node after the img tag.

      // This is the number of nodes we need to process. If new nodes
      // are created, the next text modifier functions have more nodes
      // to process.
      let textNodeCount = 1;
      for (let modifier of aTextModifiers) {
        for (let n = 0; n < textNodeCount; ++n) {
          let textNode = aNode.childNodes[i + n];

          // If we are processing nodes created by one of the previous
          // text modifier function, some of the nodes are likely not
          // text node, skip them.
          if (
            textNode.nodeType != textNode.TEXT_NODE &&
            textNode.nodeType != textNode.CDATA_SECTION_NODE
          ) {
            continue;
          }

          let result = modifier(textNode);
          textNodeCount += result;
          n += result;
        }
      }

      // newly created nodes should not be filtered, be sure we skip them!
      i += textNodeCount - 1;
    }
  }
}

function cleanupImMarkup(aText, aRuleset, aTextModifiers = []) {
  if (!gGlobalRuleset) {
    initGlobalRuleset();
  }

  let parser = new DOMParser();
  // Wrap the text to be parsed in a <span> to avoid losing leading whitespace.
  let doc = parser.parseFromString("<span>" + aText + "</span>", "text/html");
  let span = doc.querySelector("span");
  cleanupNode(span, aRuleset || gGlobalRuleset, aTextModifiers);
  return span.innerHTML;
}
