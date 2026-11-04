// ES-module face of js/outbox-core.js, for the page (js/app.js, js/views.js) and the tests.
//
// outbox-core.js is a plain script so the service worker can load it with importScripts (see its header).
// Importing it here runs it once and puts everything on globalThis.SunGridOutbox.

import './outbox-core.js';

const core = globalThis.SunGridOutbox;

export const DB_NAME = core.DB_NAME;
export const STORE_NAME = core.STORE_NAME;
export const SYNC_TAG = core.SYNC_TAG;
export const LOCK_NAME = core.LOCK_NAME;
export const FORM_NAME = core.FORM_NAME;
export const ENDPOINT = core.ENDPOINT;
export const MAX_ATTEMPTS = core.MAX_ATTEMPTS;
export const KEEP_SENT = core.KEEP_SENT;
export const REPORT_KINDS = core.REPORT_KINDS;
export const LIMITS = core.LIMITS;
export const validateReport = core.validateReport;
export const createRecord = core.createRecord;
export const encodeReport = core.encodeReport;
export const classifyStatus = core.classifyStatus;
export const sendReport = core.sendReport;
export const memoryStore = core.memoryStore;
export const openIdbStore = core.openIdbStore;
export const countRecords = core.countRecords;
export const createOutbox = core.createOutbox;
export const openOutbox = core.openOutbox;
export const flushOutbox = core.flushOutbox;
export const flushWithLock = core.flushWithLock;
export const registerBackgroundSync = core.registerBackgroundSync;
