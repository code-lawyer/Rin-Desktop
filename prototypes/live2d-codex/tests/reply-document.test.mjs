import test from 'node:test';
import assert from 'node:assert/strict';
import { webLink } from '../renderer/reply-document.mjs';

test('reply links allow explicit web navigation and reject executable or local schemes', () => {
  assert.equal(webLink('https://example.com/docs?a=1#reply'), 'https://example.com/docs?a=1#reply');
  assert.equal(webLink('http://localhost:3000'), 'http://localhost:3000/');
  for (const href of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///C:/Windows/system.ini', 'D:/example-project/app.js', '/relative/path', 'not a link']) assert.equal(webLink(href), null);
});
