import assert from 'node:assert/strict';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, test } from 'vitest';

import '@/modules/i18n';
import ComposerModelMenu from '@/modules/chat/composer/ComposerModelMenu';
import { DEFAULT_EFFORT_VALUE } from '@/shared/constants';

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value }));
const MODELS = [{ value: 'opus', label: 'Opus' }];

const renderMenu = (effort: string, { effortOptions = EFFORTS, modelOptions = MODELS } = {}) =>
  render(
    <ComposerModelMenu
      effort={effort}
      effortOptions={effortOptions}
      onSelectEffort={() => undefined}
      model="opus"
      modelOptions={modelOptions}
      onSelectModel={() => undefined}
      modelsLoading={false}
    />,
  );

const trigger = () => screen.getByTestId('chat-composer-model-button');

afterEach(cleanup);

for (const [effort, letter] of [
  [DEFAULT_EFFORT_VALUE, 'D'],
  ['low', 'L'],
  ['medium', 'M'],
  ['high', 'H'],
  ['xhigh', 'X'],
  ['max', 'Mx'],
]) {
  test(`${effort} shows as ${letter} after the model name`, () => {
    renderMenu(effort);
    assert.equal(trigger().textContent, `Opus· ${letter}`);
  });
}

test('the tooltip spells out the effort the letter stands for', () => {
  renderMenu('xhigh');
  assert.match(trigger().title, /Opus · xhigh/);
});

test('without a model list the trigger is just the letter', () => {
  renderMenu('high', { modelOptions: [] });
  assert.equal(trigger().textContent, 'H');
});

test('without effort options the trigger is just the model', () => {
  renderMenu(DEFAULT_EFFORT_VALUE, { effortOptions: [] });
  assert.equal(trigger().textContent, 'Opus');
});
