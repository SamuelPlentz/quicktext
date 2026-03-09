/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

// Abstract variables menu structure shared across the compose action menu,
// the manager flyout menu, and the legacy toolbar companion.
//
// Each node:
//   { type: "group",     id, localeKey?, children }
//   { type: "item",      id, localeKey?, value }
//   { type: "separator" }
//   { type: "dateTime",  id, value, format }
//
// Default locale key: `quicktext.${id}.label`
// Explicit localeKey overrides this for ids that contain characters not
// usable in menu ID paths (e.g. dots).

const CONTACT_FIELDS = [
  "firstname", "lastname", "fullname", "displayname", "nickname",
  "email", "workphone", "faxnumber", "cellularnumber", "jobtitle",
  "custom1", "custom2", "custom3", "custom4",
];

function contactItems(prefix) {
  return CONTACT_FIELDS.map(field => ({ type: "item", id: field, value: `${prefix}=${field}` }));
}

export function getStaticVariablesMenuStructure() {
  return [
    { type: "group", id: "to",   children: contactItems("TO") },
    { type: "group", id: "from", children: contactItems("FROM") },
    {
      type: "group", id: "attachments", children: [
        { type: "item", id: "filename",        value: "ATT=name" },
        { type: "item", id: "filenameAndSize", value: "ATT=full" },
        { type: "separator" },
        {
          type: "group", id: "attachmentFile", children: [
            { type: "item", id: "mode-file", localeKey: "quicktext.mode.file.label", value: "ATTACHMENT=FILE|<path>" },
            { type: "item", id: "mode-url",  localeKey: "quicktext.mode.url.label",  value: "ATTACHMENT=URL|<url>" },
          ]
        },
      ]
    },
    {
      type: "group", id: "dateTime", children: [
        { type: "dateTime", id: "date-short",     value: "DATE",          format: "date-short" },
        { type: "dateTime", id: "date-long",      value: "DATE=long",     format: "date-long" },
        { type: "dateTime", id: "date-monthname", value: "DATE=monthname",format: "date-monthname" },
        { type: "dateTime", id: "time-noseconds", value: "TIME",          format: "time-noseconds" },
        { type: "dateTime", id: "time-seconds",   value: "TIME=seconds",  format: "time-seconds" },
      ]
    },
    {
      type: "group", id: "other", children: [
        { type: "item", id: "clipboard",  value: "CLIPBOARD" },
        { type: "item", id: "counter",    value: "COUNTER" },
        { type: "item", id: "input",      value: "INPUT=name|type|options" },
        { type: "item", id: "selection",  value: "SELECTION" },
        { type: "item", id: "orgatt",     value: "ORGATT=\\n" },
        { type: "item", id: "orgheader",  value: "ORGHEADER=type|\\n" },
        { type: "item", id: "subject",    value: "SUBJECT" },
        { type: "item", id: "url",        value: "URL=url|data" },
        { type: "item", id: "insertfile", value: "FILE=<path>" },
        {
          type: "group", id: "image", children: [
            { type: "item", id: "mode-file", localeKey: "quicktext.mode.file.label", value: "IMAGE=FILE|<path>" },
            { type: "item", id: "mode-url",  localeKey: "quicktext.mode.url.label",  value: "IMAGE=URL|<url>" },
          ]
        },
        { type: "item", id: "version",    value: "VERSION" },
        { type: "separator" },
        { type: "item", id: "header",     value: "HEADER=type|value" },
        { type: "item", id: "cursor",     value: "CURSOR" },
      ]
    },
  ];
}

export function getStaticOtherMenuStructure() {
  return [
    { type: "item", id: "insertTextFromFileAsText", mimeType: "text/plain" },
    { type: "item", id: "insertTextFromFileAsHTML", mimeType: "text/html" },
  ];
}
