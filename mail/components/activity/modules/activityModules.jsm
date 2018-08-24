/* -*- Mode: Java; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// This module is designed to be a central place to initialise activity related
// modules.

this.EXPORTED_SYMBOLS = [];

const { sendLaterModule } = ChromeUtils.import("resource:///modules/activity/sendLater.jsm", null);
sendLaterModule.init();
const { moveCopyModule } = ChromeUtils.import("resource:///modules/activity/moveCopy.jsm", null);
moveCopyModule.init();
const { glodaIndexerActivity } = ChromeUtils.import("resource:///modules/activity/glodaIndexer.jsm", null);
glodaIndexerActivity.init();
const { autosyncModule } = ChromeUtils.import("resource:///modules/activity/autosync.jsm", null);
autosyncModule.init();
ChromeUtils.import("resource:///modules/activity/alertHook.jsm");
alertHook.init();
const { pop3DownloadModule } = ChromeUtils.import("resource:///modules/activity/pop3Download.jsm", null);
pop3DownloadModule.init();