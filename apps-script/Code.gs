/**
 * @OnlyCurrentDoc
 *
 * OfficeAgent の Google ドキュメント・スプレッドシート・スライド版。
 * サイドバー (Sidebar.html) に、GitHub Pages に置いた作業ウィンドウ (taskpane.html) を iframe で開き、
 * 作業ウィンドウからの問い合わせ (getState) に、選択している文字などを返すだけ。画面や処理の本体は taskpane.html 側にある。
 *
 * 作業ウィンドウの URL は、スクリプト プロパティの APP_URL で変えられる (開発中は https://localhost:3000/taskpane.html など)。
 */

var DEFAULT_APP_URL = 'https://argynnini.github.io/OfficeAgent-Web/taskpane.html';

/** 選択範囲から読む、スプレッドシートのセルの上限 (列全体などを選んだときに重くならないように) */
var MAX_ROWS = 200;
var MAX_COLUMNS = 26;

function onOpen(e) {
  var ui = getUi_(currentApp_());
  if (!ui) return;
  ui.createAddonMenu().addItem('表示', 'showSidebar').addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showSidebar() {
  var app = currentApp_();
  var appUrl = PropertiesService.getScriptProperties().getProperty('APP_URL') || DEFAULT_APP_URL;
  var template = HtmlService.createTemplateFromFile('Sidebar');
  template.appSrc = appUrl + (appUrl.indexOf('?') < 0 ? '?' : '&') + 'host=google&app=' + app;
  getUi_(app).showSidebar(template.evaluate().setTitle('OfficeAgent'));
}

/** 作業ウィンドウから、一定間隔で呼ばれる。app は 'docs' | 'sheets' | 'slides' */
function getState(app) {
  switch (app) {
    case 'docs': {
      var doc = DocumentApp.getActiveDocument();
      return { selection: docsSelection_(doc), paragraphs: doc.getBody().getParagraphs().length };
    }
    case 'sheets': {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      return { selection: sheetsSelection_(ss), sheet: ss.getActiveSheet().getName() };
    }
    case 'slides':
      return { selection: slidesSelection_(SlidesApp.getActivePresentation()) };
    default:
      throw new Error('知らないアプリです: ' + app);
  }
}

/**
 * どのアプリで開いているか。getUi() は、別のアプリの中で呼ぶと例外になるので、それで見分ける
 * (onOpen は権限の無いモード (AuthMode.NONE) で呼ばれることがあり、getActiveDocument() などは使えないが、getUi() は使える)
 */
function currentApp_() {
  try { DocumentApp.getUi(); return 'docs'; } catch (e) { /* ドキュメントではない */ }
  try { SpreadsheetApp.getUi(); return 'sheets'; } catch (e) { /* スプレッドシートではない */ }
  try { SlidesApp.getUi(); return 'slides'; } catch (e) { /* スライドではない */ }
  return undefined;
}

function getUi_(app) {
  switch (app) {
    case 'docs': return DocumentApp.getUi();
    case 'sheets': return SpreadsheetApp.getUi();
    case 'slides': return SlidesApp.getUi();
    default: return undefined;
  }
}

function docsSelection_(doc) {
  var selection = doc.getSelection();
  if (!selection) return '';
  return selection.getRangeElements().map(function (re) {
    var el = re.getElement();
    if (!el.editAsText) return ''; // 画像など、文字を持たない要素
    var text = el.editAsText().getText();
    return re.isPartial() ? text.substring(re.getStartOffset(), re.getEndOffsetInclusive() + 1) : text;
  }).filter(function (t) { return t; }).join('\n');
}

/** Excel (Office.js の getSelectedDataAsync) と同じく、選択したセルの表示値を、タブと改行で区切って返す */
function sheetsSelection_(ss) {
  var range = ss.getActiveRange();
  if (!range) return '';
  var rows = Math.min(range.getNumRows(), MAX_ROWS);
  var columns = Math.min(range.getNumColumns(), MAX_COLUMNS);
  var values = range.offset(0, 0, rows, columns).getDisplayValues();
  var text = values.map(function (row) { return row.join('\t'); }).join('\n');
  // 空のセルだけを選んでいるときは、選択なしとして扱う
  return text.replace(/^[\t\n]+$/, '');
}

function slidesSelection_(presentation) {
  var selection = presentation.getSelection();
  if (!selection) return '';
  switch (selection.getSelectionType()) {
    case SlidesApp.SelectionType.TEXT:
      return selection.getTextRange().asString();
    case SlidesApp.SelectionType.PAGE_ELEMENT:
      return selection.getPageElementRange().getPageElements().map(function (pe) {
        return pe.getPageElementType() === SlidesApp.PageElementType.SHAPE ? pe.asShape().getText().asString() : '';
      }).filter(function (t) { return t.trim(); }).join('\n');
    case SlidesApp.SelectionType.TABLE_CELL:
      return selection.getTableCellRange().getTableCells().map(function (cell) {
        return cell.getText().asString();
      }).join('\n');
    default:
      return '';
  }
}
