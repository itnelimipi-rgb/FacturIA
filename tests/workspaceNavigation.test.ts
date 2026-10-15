import assert from 'node:assert/strict';
import {test} from 'node:test';
import {INITIAL_WORKSPACE_NAVIGATION, workspaceNavigationReducer as navigate} from '../src/lib/workspaceNavigation';

test('uploads open the correct section and retain the movement only for its document task', () => {
  const document = navigate(INITIAL_WORKSPACE_NAVIGATION, {type: 'upload', kind: 'document-upload', movementId: 'tx-1'});
  assert.equal(document.section, 'documents');
  assert.equal(document.focusTarget, 'document-upload');
  assert.equal(document.uploadTargetId, 'tx-1');
  const bank = navigate(document, {type: 'upload', kind: 'bank-upload'});
  assert.equal(bank.section, 'movements');
  assert.equal(bank.focusTarget, 'bank-upload');
  assert.equal(bank.uploadTargetId, 'tx-1');
  assert.equal(bank.reviewRequest, undefined);
});

test('ordinary navigation preserves the review request and document context instead of resetting filters', () => {
  const upload = navigate(INITIAL_WORKSPACE_NAVIGATION, {type: 'upload', kind: 'document-upload', movementId: 'tx-1'});
  const review = navigate(upload, {type: 'records', section: 'movements', filter: 'ambiguo'});
  for (const section of ['home', 'documents', 'help', 'movements'] as const) {
    const changed = navigate(review, {type: 'section', section});
    assert.equal(changed.section, section);
    assert.equal(changed.reviewRequest, review.reviewRequest);
    assert.equal(changed.uploadTargetId, 'tx-1');
    assert.equal(changed.request, review.request + 1);
  }
});

test('a new review task gets a distinct request even when its filter is unchanged', () => {
  const first = navigate(INITIAL_WORKSPACE_NAVIGATION, {type: 'records', section: 'movements', filter: 'discrepancia'});
  const next = navigate(first, {type: 'records', section: 'movements', filter: 'discrepancia'});
  assert.equal(next.focusTarget, 'workspace-movements');
  assert.equal(next.reviewRequest?.filter, 'discrepancia');
  assert.notEqual(next.reviewRequest?.request, first.reviewRequest?.request);
});

test('opening documents does not change a saved movement review request', () => {
  const review = navigate(INITIAL_WORKSPACE_NAVIGATION, {type: 'records', section: 'movements', filter: 'ambiguo'});
  const documents = navigate(review, {type: 'records', section: 'documents'});
  assert.equal(documents.focusTarget, 'workspace-documents');
  assert.equal(documents.reviewRequest, review.reviewRequest);
});

test('a fresh document task or explicit removal clears the old movement without losing navigation', () => {
  const old = navigate(INITIAL_WORKSPACE_NAVIGATION, {type: 'upload', kind: 'document-upload', movementId: 'tx-1'});
  const fresh = navigate(old, {type: 'upload', kind: 'document-upload'});
  assert.equal(fresh.uploadTargetId, null);
  const removed = navigate(old, {type: 'clear-upload-context'});
  assert.equal(removed.uploadTargetId, null);
  assert.equal(removed.section, old.section);
  assert.equal(removed.request, old.request);
});

test('reset returns to first use and discards the previous review and movement context', () => {
  const review = navigate(INITIAL_WORKSPACE_NAVIGATION, {type: 'records', section: 'movements', filter: 'ambiguo'});
  const reset = navigate(review, {type: 'reset'});
  assert.equal(reset.section, 'home');
  assert.equal(reset.focusTarget, 'workspace-home');
  assert.equal(reset.reviewRequest, undefined);
  assert.equal(reset.uploadTargetId, null);
  assert.ok(reset.request > review.request);
});
