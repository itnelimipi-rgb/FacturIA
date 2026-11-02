import assert from 'node:assert/strict';
import {test} from 'node:test';
import {INITIAL_WORKSPACE_NAVIGATION, workspaceNavigationReducer as navigate} from '../src/lib/workspaceNavigation';

test('ordinary navigation preserves the review request instead of resetting filters', () => {
  const review = navigate(INITIAL_WORKSPACE_NAVIGATION, {type: 'records', section: 'movements', filter: 'pending'});
  for (const section of ['home', 'documents', 'help', 'movements'] as const) {
    const changed = navigate(review, {type: 'section', section});
    assert.equal(changed.section, section);
    assert.equal(changed.reviewRequest, review.reviewRequest);
    assert.equal(changed.request, review.request + 1);
  }
});

test('a new review task gets a distinct request even when its filter is unchanged', () => {
  const first = navigate(INITIAL_WORKSPACE_NAVIGATION, {type: 'records', section: 'movements', filter: 'pending'});
  const next = navigate(first, {type: 'records', section: 'movements', filter: 'pending'});
  assert.equal(next.focusTarget, 'workspace-movements');
  assert.equal(next.reviewRequest?.filter, 'pending');
  assert.notEqual(next.reviewRequest?.request, first.reviewRequest?.request);
});

test('opening documents does not change a saved movement review request', () => {
  const review = navigate(INITIAL_WORKSPACE_NAVIGATION, {type: 'records', section: 'movements', filter: 'conciliado'});
  const documents = navigate(review, {type: 'records', section: 'documents'});
  assert.equal(documents.section, 'documents');
  assert.equal(documents.focusTarget, 'workspace-documents');
  assert.equal(documents.reviewRequest, review.reviewRequest);
});

test('reset returns to first use and discards the previous review', () => {
  const review = navigate(INITIAL_WORKSPACE_NAVIGATION, {type: 'records', section: 'movements', filter: 'pending'});
  const reset = navigate(review, {type: 'reset'});
  assert.equal(reset.section, 'home');
  assert.equal(reset.focusTarget, 'workspace-home');
  assert.equal(reset.reviewRequest, undefined);
  assert.ok(reset.request > review.request);
});
