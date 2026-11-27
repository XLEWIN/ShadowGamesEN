import React from 'react';
import { describe, expect, it, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import HubApp from './HubApp.jsx';

async function mount() {
  const view = render(<HubApp />);
  const skip = screen.queryByRole('button', { name: /skip intro/i });
  if (skip) fireEvent.click(skip);
  await waitFor(() => expect(screen.queryByText('PREPARING THE GAME ROOM')).toBeNull());
  return view;
}

describe('Shadow Games hub (v4 reference design)', () => {
  beforeEach(() => { window.Telegram.WebApp.startParam = ''; });

  it('shows the Code Council loader and skips it', async () => {
    render(<HubApp />);
    expect(screen.getByText('CODE COUNCIL PRESENTS')).toBeInTheDocument();
    expect(screen.getByText(/PREPARING THE GAME ROOM/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /skip intro/i }));
    await waitFor(() => expect(screen.queryByText(/PREPARING THE GAME ROOM/i)).toBeNull());
  });

  it('renders the cinematic hero and four games', async () => {
    await mount();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/make your/i);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/next move/i);
    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByRole('heading', { name: 'Chess' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ludo' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wordseek' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wordguess' })).toBeInTheDocument();
  });

  it('filters word games', async () => {
    await mount();
    fireEvent.click(screen.getByRole('tab', { name: /word games/i }));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Wordseek' })).toBeInTheDocument());
    expect(screen.getByRole('tab', { name: /word games/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens a preview dialog and closes it with Escape', async () => {
    await mount();
    fireEvent.click(screen.getAllByRole('button', { name: /preview/i })[0]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: /close preview/i })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens the command palette with Ctrl+K and filters games', async () => {
    await mount();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = await screen.findByPlaceholderText(/search games, styles/i);
    const panel = input.closest('.command-panel');
    fireEvent.change(input, { target: { value: 'ludo' } });
    await waitFor(() => expect(within(panel).queryByText('Chess')).toBeNull());
    expect(within(panel).getByText('Ludo')).toBeInTheDocument();
  });

  it('exposes an accessible mobile navigation toggle', async () => {
    const { container } = await mount();
    const menu = container.querySelector('[aria-label="Toggle navigation"]');
    expect(menu).toBeTruthy();
    fireEvent.click(menu);
    expect(container.querySelector('.nav-links.show')).toBeTruthy();
  });
});
