import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HubApp from './HubApp.jsx';

async function mount() {
  const view = render(<HubApp />);
  const skip = screen.queryByRole('button', { name: /skip intro/i });
  if (skip) fireEvent.click(skip);
  await waitFor(() => expect(screen.queryByLabelText('Loading Shadow Games')).toBeNull());
  return view;
}

describe('Shadow Games hub', () => {
  beforeEach(() => { window.Telegram.WebApp.startParam = ''; });

  it('renders the cinematic hero and all four games behind filter tabs', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/make your/i);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/next move/i);
    expect(screen.getByRole('tablist', { name: /game categories/i })).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'CHESS' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'LUDO' })).toBeInTheDocument();
  });

  it('switches to the word games tab', async () => {
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: 'Word Games' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'WORDSEEK' })).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'WORDGUESS' })).toBeInTheDocument();
    });
    expect(screen.getByRole('tab', { name: 'Word Games' })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens an accessible preview modal and closes it with Escape', async () => {
    await mount();
    fireEvent.click(screen.getAllByRole('button', { name: /preview & play/i })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('Close preview')).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('has no persistent sound toggle and unlocks audio on first gesture', async () => {
    await mount();
    expect(screen.queryByRole('button', { name: /sound/i })).toBeNull();
    expect(screen.queryByRole('button', { pressed: true })).toBeNull();
  });
});
