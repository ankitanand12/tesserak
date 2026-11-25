import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ConnectorForm from './ConnectorForm';

describe('ConnectorForm submit lock and error handling', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'success', accountId: '123456789012' }),
    } as Response);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.clearAllMocks();
  });

  test('prevents duplicate submissions on rapid multiple clicks while saving', async () => {
    let resolveSave!: () => void;
    const onSubmit = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );

    render(<ConnectorForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/Account Name/i), {
      target: { value: 'Deloitte' },
    });
    fireEvent.change(screen.getByLabelText(/AWS Access Key/i), {
      target: { value: 'AKIATESTKEY123456' },
    });
    fireEvent.change(screen.getByLabelText(/AWS Secret Key/i), {
      target: { value: 'secret-value-123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));
    expect(await screen.findByText(/Connected successfully!/i)).toBeInTheDocument();

    const submitBtn = screen.getByRole('button', { name: /^Submit$/i });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: /Saving.../i })).toBeDisabled();

    resolveSave();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^Submit$/i })).toBeEnabled();
    });
  });

  test('renders submission error inside form if onSubmit rejects', async () => {
    const onSubmit = jest.fn().mockRejectedValue(new Error('AWS STS validation failed'));

    render(<ConnectorForm onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText(/AWS Access Key/i), {
      target: { value: 'AKIATESTKEY123456' },
    });
    fireEvent.change(screen.getByLabelText(/AWS Secret Key/i), {
      target: { value: 'secret-value-123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));
    expect(await screen.findByText(/Connected successfully!/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Submit$/i }));

    expect(await screen.findByText(/AWS STS validation failed/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Submit$/i })).toBeEnabled();
  });
});
