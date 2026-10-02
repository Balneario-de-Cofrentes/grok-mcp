import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_DEPTH, DEPTHS, depthGuide, isMultiAgent, resolveModel } from '../build/profiles.js';

test('default depth is quick: grok-4.3 at low effort', () => {
  assert.equal(DEFAULT_DEPTH, 'quick');
  assert.deepEqual(resolveModel({}), { model: 'grok-4.3', effort: 'low' });
});

test('each depth maps to its model and effort', () => {
  assert.deepEqual(resolveModel({ depth: 'standard' }), { model: 'grok-4.7', effort: 'low' });
  assert.deepEqual(resolveModel({ depth: 'deep' }), { model: 'grok-4.7', effort: 'high' });
  assert.deepEqual(resolveModel({ depth: 'research' }), { model: 'grok-4.20-multi-agent', effort: 'low' });
});

test('explicit model and reasoning_effort override the depth profile', () => {
  assert.deepEqual(resolveModel({ depth: 'deep', model: 'grok-4.6' }), { model: 'grok-4.6', effort: 'high' });
  assert.deepEqual(resolveModel({ depth: 'research', reasoning_effort: 'high' }), {
    model: 'grok-4.20-multi-agent',
    effort: 'high',
  });
});

test('unknown depth and effort are rejected with the valid options', () => {
  assert.throws(() => resolveModel({ depth: 'turbo' }), /Unknown depth "turbo".*quick, standard, deep, research/);
  assert.throws(() => resolveModel({ depth: 'toString' }), /Unknown depth "toString"/);
  assert.throws(() => resolveModel({ reasoning_effort: 'max' }), /Unknown reasoning_effort "max"/);
});

test('isMultiAgent recognises the multi-agent model and its dated ids', () => {
  assert.equal(isMultiAgent('grok-4.20-multi-agent'), true);
  assert.equal(isMultiAgent('grok-4.20-multi-agent-0309'), true);
  assert.equal(isMultiAgent('grok-4.7'), false);
});

test('depthGuide describes every depth', () => {
  const guide = depthGuide();
  for (const depth of Object.keys(DEPTHS)) {
    assert.match(guide, new RegExp(`"${depth}":`));
  }
});
