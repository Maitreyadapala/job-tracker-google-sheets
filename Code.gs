/**
 * JOB TRACKER, starter script for Google Sheets (Google Apps Script). MIT licence.
 *
 * What it does every morning:
 *   1. Reads the open job feeds of the companies listed on the "Boards" tab
 *      (Greenhouse, Lever and Ashby feeds, which companies publish for other sites to read).
 *   2. Keeps the roles that fit the rules on your "Settings" tab and scores them from 0 to 100.
 *   3. Writes new roles to "Jobs" and the rejected ones, with the reason, to "Filtered out".
 *   4. Reads your Gmail for replies and sets the matching row to Applied, Interview or Rejected.
 *   5. Emails you the new roles and your best roles not applied to yet.
 *
 * Setup: paste this file into Extensions > Apps Script, save, and reload the sheet. A "Job tracker"
 * menu appears in the sheet. Everything else is done from that menu:
 *   1. Set up this sheet         builds the tabs in an empty Google Sheet
 *   2. Add a company             type a company name, the script finds its job feed
 *   3. Test run                  shows what it would add. Changes nothing, sends nothing
 *   4. Turn on the daily run     from then on it runs by itself every day at about 8am
 */

var JOB_HEADERS = ['S.no', 'Date added', 'Brand', 'Parent group', 'Job title', 'Match', 'Why', 'Location', 'Contract',
                   'Visa / remote', 'Link', 'Person hiring', 'CV', 'Find contact', 'Category', 'Status', 'Notes', 'Exp',
                   'Fit note', 'Missing'];
var COL = {};
JOB_HEADERS.forEach(function(h, i){ COL[h] = i; });
var MAIL_LABEL = 'tracker-seen';
var LANGUAGES = ['english', 'french', 'german', 'spanish', 'italian', 'dutch', 'portuguese', 'polish', 'swedish', 'danish',
                 'norwegian', 'finnish', 'czech', 'greek', 'turkish', 'arabic', 'hebrew', 'mandarin', 'chinese', 'japanese',
                 'korean', 'russian', 'hindi'];

function dryRun() { run_(true); }
function dailyRun() { run_(false); }
function setupDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction() === 'dailyRun') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyRun').timeBased().atHour(8).everyDays(1).create();
  Logger.log('Done: dailyRun now starts by itself every day at about 8am.');
}

// ---------------------------------------------------------------- the "Job tracker" menu in the sheet
// After the first paste you never need this editor again: everything is in the menu.
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Job tracker')
    .addItem('1. Set up this sheet', 'menuSetup')
    .addItem('2. Add a company', 'menuAddCompany')
    .addItem('3. Test run (changes nothing)', 'menuTestRun')
    .addItem('4. Turn on the daily run', 'menuTurnOn')
    .addSeparator()
    .addItem('Run now', 'menuRunNow')
    .addItem('Turn off the daily run', 'menuTurnOff')
    .addToUi();
}
function say_(text) {
  try { SpreadsheetApp.getUi().alert(text); } catch (e) { Logger.log(text); }
}
/** Builds the tabs in an empty Google Sheet. Safe to run again: it never overwrites a tab that has content. */
function menuSetup() {
  var ss = SpreadsheetApp.getActive();
  var st = ss.getSheetByName('Settings');
  if (!st) {
    st = ss.insertSheet('Settings', 0);
    var rows = [
      ['Setting', 'Your answer (type in the yellow cells)', 'Example'],
      ['Target job titles', '', 'marketing, community manager, events, partnerships'],
      ['Top sectors', '', 'dating, events, consumer app'],
      ['Maximum years of experience asked', '', 3],
      ['Languages you work in', '', 'English'],
      ['Home city and country', '', 'Paris, France'],
      ['Other countries you accept', '', 'UK, United Kingdom, Netherlands, Germany'],
      ['Visa (a note for you)', '', 'I need sponsorship outside France'],
      ['Contract (a note for you)', '', 'Full-time'],
      ['Lowest Match to keep', 50, 50],
      ['Shortlist size', 30, 30]
    ];
    st.getRange(1, 1, rows.length, 3).setValues(rows).setWrap(true).setVerticalAlignment('top');
    st.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#e8eef7');
    st.getRange('B2:B11').setBackground('#fff2a8');
    st.getRange('C2:C11').setFontColor('#888888');
    st.setColumnWidth(1, 260); st.setColumnWidth(2, 380); st.setColumnWidth(3, 380);
    st.setFrozenRows(1);
  }
  var make = function(name, headers){
    var t = ss.getSheetByName(name) || ss.insertSheet(name);
    if (t.getLastRow() === 0) {
      t.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#e8eef7');
      t.setFrozenRows(1);
    }
    return t;
  };
  var jobs = make('Jobs', JOB_HEADERS);
  make('Best for me', JOB_HEADERS);
  make('Boards', ['Company', 'Category', 'System', 'Board id', 'Open roles when found', 'Found on', 'Use (yes / no)']);
  make('Filtered out', ['Link', 'Why', 'When']);
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['New', 'Interested', 'Applied', 'Interview', 'Offer', 'Accepted', 'Rejected', 'Not for me', 'Link expired'], true)
    .setAllowInvalid(true).build();
  jobs.getRange(2, COL['Status'] + 1, 2000, 1).setDataValidation(rule);
  var first = ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
  ss.setActiveSheet(st);
  say_('Your tracker is ready.\n\nNext: fill in the yellow cells on the Settings tab. Then click Job tracker > Add a company.');
}
function menuTestRun() { say_(run_(true)); }
function menuRunNow() { say_(run_(false)); }
function menuTurnOn() {
  setupDailyTrigger();
  say_('Done. The tracker now runs by itself every day at about 8am and emails you the result. You can close this sheet.');
}
function menuTurnOff() {
  ScriptApp.getProjectTriggers().forEach(function(t){ if (t.getHandlerFunction() === 'dailyRun') ScriptApp.deleteTrigger(t); });
  say_('The daily run is off.');
}
/** Asks for a company name, looks for its open job feed, and adds it to the Boards tab. */
function menuAddCompany() {
  var ui = SpreadsheetApp.getUi();
  var a = ui.prompt('Add a company', 'Type the company name (for example: Duolingo)', ui.ButtonSet.OK_CANCEL);
  if (a.getSelectedButton() !== ui.Button.OK) return;
  var name = String(a.getResponseText() || '').trim();
  if (!name) return;
  var hit = findBoard_(name);
  if (!hit) {
    ui.alert('No open job feed found for "' + name + '".\n\nThis tracker reads companies that use Greenhouse, Lever or Ashby for their careers page. Check the spelling, or try the name without spaces. If it still fails, the company uses another system.');
    return;
  }
  var c = ui.prompt('Found ' + name + ' (' + hit.n + ' open roles)', 'What kind of company is it? One or two words, for example: Dating, Events, Consumer app, Fintech', ui.ButtonSet.OK_CANCEL);
  var cat = c.getSelectedButton() === ui.Button.OK ? String(c.getResponseText() || '').trim() : '';
  var tab = SpreadsheetApp.getActive().getSheetByName('Boards');
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  tab.getRange(tab.getLastRow() + 1, 1, 1, 7).setValues([[name, cat || 'Company', hit.system, hit.id, hit.n, today, 'yes']]);
  ui.alert(name + ' was added to the Boards tab.');
}
/** Tries the usual spellings of a company name on the 3 job systems. Returns the feed with the most open roles, or null. */
function findBoard_(name) {
  var flat = String(name).toLowerCase().replace(/&/g, ' and ');
  var joined = flat.replace(/[^a-z0-9]+/g, ''), dashed = flat.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  var ids = [joined];
  if (dashed !== joined) ids.push(dashed);
  var best = null;
  ids.forEach(function(id){
    [['greenhouse', 'https://boards-api.greenhouse.io/v1/boards/' + id + '/jobs'],
     ['lever', 'https://api.lever.co/v0/postings/' + id + '?mode=json'],
     ['ashby', 'https://api.ashbyhq.com/posting-api/job-board/' + id]].forEach(function(t){
      try {
        var r = UrlFetchApp.fetch(t[1], { muteHttpExceptions: true });
        if (r.getResponseCode() !== 200) return;
        var d = JSON.parse(r.getContentText());
        var n = t[0] === 'lever' ? (Array.isArray(d) ? d.length : 0) : (d.jobs || []).length;
        if (n > 0 && (!best || n > best.n)) best = { system: t[0], id: id, n: n };
      } catch (e) {}
    });
  });
  return best;
}

// ---------------------------------------------------------------- settings
function list_(v) {
  return String(v || '').toLowerCase().split(/[,;\n]+/).map(function(x){ return x.trim(); }).filter(String);
}
function settings_(ss) {
  var v = ss.getSheetByName('Settings').getRange('B2:B11').getValues().map(function(r){ return r[0]; });
  return {
    titles: list_(v[0]), sectors: list_(v[1]), maxYears: Number(v[2]) || 99, languages: list_(v[3]),
    home: list_(v[4]), places: list_(v[5]), minMatch: Number(v[8]) || 50, top: Number(v[9]) || 30
  };
}

// ---------------------------------------------------------------- reading the feeds
function plain_(html) {
  return String(html || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, '. ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
function fetchBoard_(b) {
  var id = encodeURIComponent(b.id), url;
  if (b.system === 'greenhouse') url = 'https://boards-api.greenhouse.io/v1/boards/' + id + '/jobs?content=true';
  else if (b.system === 'lever') url = 'https://api.lever.co/v0/postings/' + id + '?mode=json';
  else if (b.system === 'ashby') url = 'https://api.ashbyhq.com/posting-api/job-board/' + id;
  else throw new Error('unknown system "' + b.system + '" (use greenhouse, lever or ashby)');
  var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('HTTP ' + r.getResponseCode());
  var d = JSON.parse(r.getContentText());
  if (b.system === 'greenhouse') return (d.jobs || []).map(function(j){
    return { title: j.title, location: (j.location && j.location.name) || '', url: j.absolute_url, text: plain_(j.content) };
  });
  if (b.system === 'lever') return (Array.isArray(d) ? d : []).map(function(j){
    var extra = (j.lists || []).map(function(l){ return l.text + ': ' + plain_(l.content); }).join('. ');
    return { title: j.text, location: (j.categories && j.categories.location) || '', url: j.hostedUrl,
             text: (j.descriptionPlain || plain_(j.description)) + '. ' + extra };
  });
  return (d.jobs || []).map(function(j){
    return { title: j.title, location: j.location || '', url: j.jobUrl, text: j.descriptionPlain || plain_(j.descriptionHtml) };
  });
}

// ---------------------------------------------------------------- the rules
/** The title must contain one of your target titles, or every word of one. */
function titleFit_(title, titles) {
  var t = ' ' + String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
  var best = 0;
  titles.forEach(function(want){
    var w = want.replace(/[^a-z0-9]+/g, ' ').trim();
    if (!w) return;
    if (t.indexOf(' ' + w + ' ') >= 0) { best = Math.max(best, 35); return; }
    var words = w.split(' ');
    if (words.every(function(x){ return t.indexOf(' ' + x) >= 0; })) best = Math.max(best, 25);
  });
  return best;
}
/** Years of experience asked for: the lower end of the first figure found, or null. */
function yearsFrom_(text) {
  var m = String(text || '').toLowerCase().match(/(\d{1,2})\s*\+?\s*(?:(?:-|–|to)\s*\d{1,2}\s*\+?\s*)?(?:years?|yrs?)(?:['’]s?)?(?:\s+of)?[^.]{0,60}?(?:experience|background|track record)/);
  return m ? Number(m[1]) : null;
}
/** A language the advert clearly requires and you did not list, or ''. "A plus" does not count. */
function languageNeeded_(text, mine) {
  var sentences = String(text || '').toLowerCase().split(/[.!?;\n•]+/);
  var hard = /fluent|fluency|native|bilingual|proficien|mandatory|required|essential|a must|speaker|speaking|courant|maitrise|maîtrise|obligatoire/;
  var soft = /\bplus\b|bonus|nice to have|advantage|asset|preferred|desirable|not required|optional|ideally|atout/;
  var place = /\b(market|markets|company|companies|office|team|clients?|customers?|law|government|capital)\b/;
  for (var i = 0; i < sentences.length; i++) {
    var s = sentences[i];
    if (!hard.test(s) || soft.test(s)) continue;
    for (var k = 0; k < LANGUAGES.length; k++) {
      var lang = LANGUAGES[k];
      if (mine.indexOf(lang) >= 0) continue;
      var at = s.search(new RegExp('\\b' + lang + '\\b'));
      if (at < 0) continue;
      if (place.test(s.slice(at + lang.length, at + lang.length + 12))) continue;   // "the French market" is a place
      // "English or French": one of your languages is enough.
      var either = mine.some(function(m){ return new RegExp('\\b' + m + '\\b\\s*(or|\\/)\\s*\\b' + lang + '\\b|\\b' + lang + '\\b\\s*(or|\\/)\\s*\\b' + m + '\\b').test(s); });
      if (either) continue;
      return lang.charAt(0).toUpperCase() + lang.slice(1);
    }
  }
  return '';
}
/** 10 for your home city, 7 for your home country, 5 for another place you accept or remote, -1 for anywhere else. */
function placePoints_(location, s) {
  var l = String(location || '').toLowerCase();
  if (s.home.length && l.indexOf(s.home[0]) >= 0) return 10;
  if (s.home.slice(1).some(function(h){ return l.indexOf(h) >= 0; })) return 7;
  if (s.places.some(function(p){ return l.indexOf(p) >= 0; }) || /remote|anywhere/.test(l)) return 5;
  return l ? -1 : 3;
}
function score_(j, b, s, years) {
  var why = [];
  var fit = titleFit_(j.title, s.titles);
  why.push('title ' + fit);
  var words = {};
  s.titles.join(' ').split(/[^a-z0-9]+/).forEach(function(w){ if (w.length > 3) words[w] = 1; });
  var all = Object.keys(words), text = String(j.text || '').toLowerCase();
  var found = all.filter(function(w){ return text.indexOf(w) >= 0; }).length;
  var skills = all.length ? Math.round(25 * found / all.length) : 0;
  why.push('skills ' + skills);
  var cat = String(b.category || '').toLowerCase();
  var sector = s.sectors.some(function(x){ return cat && (x.indexOf(cat) >= 0 || cat.indexOf(x) >= 0); }) ? 15 : 5;
  why.push('sector ' + sector);
  var exp = years === null ? 10 : years <= 2 ? 15 : years <= 3 ? 12 : 8;
  why.push(years === null ? 'years not stated' : years + ' yrs');
  var place = Math.max(0, placePoints_(j.location, s));
  why.push('place ' + place);
  return { n: Math.min(100, fit + skills + sector + exp + place), why: why.join(', ') };
}

// ---------------------------------------------------------------- the run
function run_(dry) {
  var ss = SpreadsheetApp.getActive();
  if (!ss.getSheetByName('Settings') || !ss.getSheetByName('Jobs') || !ss.getSheetByName('Boards') || !ss.getSheetByName('Filtered out')) {
    return 'This sheet is not set up yet. Click Job tracker > Set up this sheet first.';
  }
  var s = settings_(ss);
  if (!s.titles.length) return 'Your Settings tab is empty. Type your target job titles in the first yellow cell, then try again.';
  var jobs = ss.getSheetByName('Jobs'), out = ss.getSheetByName('Filtered out'), boardsTab = ss.getSheetByName('Boards');
  var tz = Session.getScriptTimeZone(), today = Utilities.formatDate(new Date(), tz, 'dd/MM/yyyy');
  var seen = {};
  if (jobs.getLastRow() > 1) jobs.getRange(2, COL['Link'] + 1, jobs.getLastRow() - 1, 1).getValues().forEach(function(r){ if (r[0]) seen[String(r[0])] = 1; });
  if (out.getLastRow() > 1) out.getRange(2, 1, out.getLastRow() - 1, 1).getValues().forEach(function(r){ if (r[0]) seen[String(r[0])] = 1; });

  var boards = boardsTab.getLastRow() > 1 ? boardsTab.getRange(2, 1, boardsTab.getLastRow() - 1, 7).getValues() : [];
  var fresh = [], dropped = [], listed = 0, errors = [];
  boards.forEach(function(r){
    var b = { name: String(r[0]), category: String(r[1]), system: String(r[2]).toLowerCase().trim(), id: String(r[3]).trim() };
    if (!b.name || !b.id || /^\s*no\s*$/i.test(String(r[6]))) return;
    var list;
    try { list = fetchBoard_(b); } catch (e) { errors.push(b.name + ': ' + e.message); return; }
    list.forEach(function(j){
      listed++;
      if (!j.url || seen[j.url]) return;
      seen[j.url] = 1;
      if (!titleFit_(j.title, s.titles)) return;                       // not your kind of role: not even recorded
      var years = yearsFrom_(j.text);
      if (placePoints_(j.location, s) < 0) { dropped.push([j.url, 'place: ' + j.location, today]); return; }
      if (years !== null && years > s.maxYears) { dropped.push([j.url, 'years:' + years, today]); return; }
      var lang = languageNeeded_(j.title + '. ' + j.text, s.languages);
      if (lang) { dropped.push([j.url, 'needs ' + lang, today]); return; }
      var sc = score_(j, b, s, years);
      if (sc.n < s.minMatch) { dropped.push([j.url, 'low match', today]); return; }
      var row = JOB_HEADERS.map(function(){ return ''; });
      row[COL['Date added']] = today; row[COL['Brand']] = b.name; row[COL['Job title']] = j.title; row[COL['Match']] = sc.n;
      row[COL['Why']] = sc.why; row[COL['Location']] = j.location; row[COL['Link']] = j.url; row[COL['Category']] = b.category;
      row[COL['Status']] = 'New'; row[COL['Exp']] = years === null ? '?' : years;
      fresh.push(row);
    });
    Utilities.sleep(300);
  });
  fresh.sort(function(a, b){ return b[COL['Match']] - a[COL['Match']]; });
  var report = (dry ? 'TEST RUN. ' : '') + listed + ' roles read from your companies. ' + fresh.length + ' fit your settings, ' + dropped.length + ' were filtered out.\n' +
               (errors.length ? 'Companies with a problem: ' + errors.join(' ; ') + '\n' : '') +
               (fresh.length ? '\nBest matches:\n' + fresh.slice(0, 10).map(function(r){ return r[COL['Match']] + '  ' + r[COL['Brand']] + ', ' + r[COL['Job title']] + ' (' + r[COL['Location']] + ')'; }).join('\n') : '') +
               (!boards.length ? '\nYour Boards tab is empty. Use Job tracker > Add a company first.' : '') +
               (boards.length && !fresh.length && jobs.getLastRow() < 2 ? '\nNothing fits yet. Add more companies, or make your target job titles on the Settings tab shorter (for example "marketing" and not "senior growth marketing manager").' : '');
  Logger.log(report);
  if (dry) return report + '\n\nNothing was written and no email was sent.';

  if (fresh.length) {
    var start = jobs.getLastRow();
    fresh.forEach(function(r, i){ r[COL['S.no']] = start + i; });
    jobs.getRange(start + 1, 1, fresh.length, JOB_HEADERS.length).setValues(fresh);
  }
  if (dropped.length) out.getRange(out.getLastRow() + 1, 1, dropped.length, 3).setValues(dropped);
  var mail = '';
  try { mail = syncMail_(ss); } catch (e) { mail = 'Mail not read: ' + e.message; }
  refreshBest_(ss, s);
  sendEmail_(ss, s, fresh, mail, errors);
  return report + (fresh.length ? '\n\nThe new roles are on the Jobs tab and an email is on its way to you.' : '\n\nNo new roles since the last run. An email is on its way to you.');
}

/** The "Best for me" tab: your best untouched rows. */
function refreshBest_(ss, s) {
  var jobs = ss.getSheetByName('Jobs'), best = ss.getSheetByName('Best for me');
  if (!best || jobs.getLastRow() < 2) return;
  var rows = jobs.getRange(2, 1, jobs.getLastRow() - 1, JOB_HEADERS.length).getValues()
    .filter(function(r){ var st = String(r[COL['Status']]).trim(); return !st || st === 'New'; })
    .sort(function(a, b){ return Number(b[COL['Match']]) - Number(a[COL['Match']]); }).slice(0, s.top);
  if (best.getLastRow() > 1) best.getRange(2, 1, best.getLastRow() - 1, JOB_HEADERS.length).clearContent();
  if (rows.length) best.getRange(2, 1, rows.length, JOB_HEADERS.length).setValues(rows);
}

// ---------------------------------------------------------------- mail
var REJECT_RE = /unfortunately|regret to inform|not (be )?(moving|going|proceeding) forward|decided (not )?to (move|proceed|go)|other (candidates|applicants)|not (been )?selected|position (has been|was) filled|pursue other/i;
var INTERVIEW_RE = /invite you to (an? )?(first |video |phone )?(interview|call)|schedule (an?|your) (interview|call)|book (a|your) (slot|time|interview)/i;
var RECEIVED_RE = /thank(s| you) for (applying|your application)|received your application|application (has been |was )?(received|submitted)/i;

/** Finds the tracker's Gmail label, or makes it. Gmail treats names that differ only by case, spaces or hyphens as the same label. */
function mailLabel_() {
  var norm = function(n){ return String(n).toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var found = GmailApp.getUserLabels().filter(function(l){ return norm(l.getName()) === norm(MAIL_LABEL); })[0];
  return found || GmailApp.createLabel(MAIL_LABEL);
}

/** Reads the last 3 days of mail. A reply changes a row only when exactly 1 row of that company can take the change. */
function syncMail_(ss) {
  var jobs = ss.getSheetByName('Jobs');
  if (jobs.getLastRow() < 2) return 'Mail: no rows yet.';
  var range = jobs.getRange(2, 1, jobs.getLastRow() - 1, JOB_HEADERS.length), rows = range.getValues();
  var label = mailLabel_();
  var threads = GmailApp.search('newer_than:3d -in:sent -label:' + MAIL_LABEL + ' (application OR applying OR candidature OR unfortunately OR interview)', 0, 100);
  var tz = Session.getScriptTimeZone(), day = Utilities.formatDate(new Date(), tz, 'd MMM'), changed = 0, unsure = 0;
  threads.forEach(function(th){
    var msgs = th.getMessages(), m = msgs[msgs.length - 1];
    var head = m.getFrom() + ' ' + m.getSubject(), text = (head + ' ' + m.getPlainBody().slice(0, 2500)).replace(/\s+/g, ' ');
    var kind = REJECT_RE.test(text) ? 'Rejected' : INTERVIEW_RE.test(text) ? 'Interview' : RECEIVED_RE.test(text) ? 'Applied' : '';
    if (!kind) return;
    var allowed = kind === 'Applied' ? ['', 'New', 'Interested'] : kind === 'Interview' ? ['', 'New', 'Interested', 'Applied'] : ['Interested', 'Applied', 'Interview'];
    var hits = [];
    rows.forEach(function(r, i){
      var brand = String(r[COL['Brand']]).trim();
      if (brand.length < 4) return;
      // the company must be named in the sender or the subject, as a whole word, with its capital letter
      var named = new RegExp('(^|[^A-Za-z0-9])' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9]|$)').test(head);
      if (named && allowed.indexOf(String(r[COL['Status']]).trim()) >= 0) hits.push(i);
    });
    if (hits.length === 1) {
      var r = rows[hits[0]];
      r[COL['Status']] = kind;
      r[COL['Notes']] = (r[COL['Notes']] ? r[COL['Notes']] + ' | ' : '') + kind + ' email ' + day;
      changed++;
      th.addLabel(label);
    } else if (hits.length > 1) {
      hits.forEach(function(i){
        var note = kind + ' email ' + day + ' (several roles here, check which)';
        if (String(rows[i][COL['Notes']]).indexOf(note) < 0) rows[i][COL['Notes']] = (rows[i][COL['Notes']] ? rows[i][COL['Notes']] + ' | ' : '') + note;
      });
      unsure++;
      th.addLabel(label);
    }
  });
  if (changed || unsure) range.setValues(rows);
  return 'Mail: ' + threads.length + ' emails read, ' + changed + ' rows updated, ' + unsure + ' emails noted on several rows.';
}

function esc_(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function table_(rows) {
  var b = '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px"><tr style="background:#f1f1f1;text-align:left"><th>Match</th><th>Company</th><th>Role</th><th>Place</th></tr>';
  rows.forEach(function(r){
    b += '<tr style="border-top:1px solid #ddd"><td>' + esc_(r[COL['Match']]) + '</td><td>' + esc_(r[COL['Brand']]) + '</td><td><a href="' + esc_(r[COL['Link']]) + '">' +
         esc_(r[COL['Job title']]) + '</a></td><td>' + esc_(r[COL['Location']]) + '</td></tr>';
  });
  return b + '</table>';
}
function sendEmail_(ss, s, fresh, mail, errors) {
  var to = Session.getEffectiveUser().getEmail();
  if (!to) return;
  var best = ss.getSheetByName('Best for me');
  var top = best && best.getLastRow() > 1 ? best.getRange(2, 1, best.getLastRow() - 1, JOB_HEADERS.length).getValues() : [];
  var b = '<div style="font-family:Arial,sans-serif;font-size:14px;color:#222">';
  b += '<p><b>' + fresh.length + ' new role' + (fresh.length === 1 ? '' : 's') + ' today.</b> ' + esc_(mail) + '</p>';
  if (fresh.length) b += table_(fresh.slice(0, 40));
  if (top.length) b += '<p style="margin-top:18px"><b>Your ' + top.length + ' best roles not applied to yet</b></p>' + table_(top);
  if (errors.length) b += '<p style="color:#999;font-size:12px">Boards with a problem: ' + esc_(errors.slice(0, 10).join(' ; ')) + '</p>';
  b += '<p><a href="' + ss.getUrl() + '">Open the tracker</a></p></div>';
  MailApp.sendEmail({ to: to, subject: 'Job tracker: ' + fresh.length + ' new role' + (fresh.length === 1 ? '' : 's'), htmlBody: b });
}
