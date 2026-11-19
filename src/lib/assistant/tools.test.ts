import { describe, expect, it, vi } from 'vitest';
import { loadMenu } from '../menu-data';
import { executeAssistantTool, type AssistantToolContext } from './tools';

const now = new Date('2026-11-18T04:30:00.000Z');
const context = (overrides: Partial<AssistantToolContext> = {}) => ({
  menu: loadMenu(),
  now,
  loadAvailability: vi
    .fn()
    .mockResolvedValue([
      { start_time: '12:00:00', remaining: 1, requestable: false },
    ]),
  logUnanswered: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

describe('assistant tools', () => {
  it('filters the current menu with strict criteria', async () => {
    const result = await executeAssistantTool(
      'search_menu',
      {
        vegan: true,
        gluten_free: true,
        max_price: 3,
        avoid_allergens: ['nuts'],
        max_spice: 1,
        limit: 8,
      },
      context(),
    );
    const items = result.output.items as {
      price: number;
      vegan: boolean;
      glutenFree: boolean;
      allergens: string[];
      spice: number;
    }[];
    expect(items.length).toBeGreaterThan(0);
    expect(
      items.every(
        (item) =>
          item.price <= 3 &&
          item.vegan &&
          item.glutenFree &&
          !item.allergens.includes('nuts') &&
          item.spice <= 1,
      ),
    ).toBe(true);
  });

  it('rejects unknown tool arguments without leaking details', async () => {
    const result = await executeAssistantTool(
      'search_menu',
      { query: 'chai', status: 'hidden' },
      context(),
    );
    expect(result.output).toEqual({
      error: 'That request could not be completed.',
    });
  });

  it.each([
    ['search_menu', { limit: 9 }],
    ['get_hours', { date: '2026-11-20', extra: true }],
    ['check_availability', { date: '2026-11-20', party_size: 0 }],
    ['propose_cart_add', { items: [{ id: 'PH0001', qty: 0 }] }],
    [
      'propose_booking',
      { date: '2026-11-20', time: '12:00', party_size: 4, name: 'Bad\nName' },
    ],
    ['log_unanswered', { topic: '' }],
    ['handoff', { reason: 'Complaint', phone: 'not allowed' }],
  ])('strictly rejects invalid %s arguments', async (name, args) => {
    const result = await executeAssistantTool(name, args, context());
    expect(result.output).toHaveProperty('error');
    expect(result.actions).toEqual([]);
  });

  it('gets hours from the shared rules', async () => {
    const result = await executeAssistantTool(
      'get_hours',
      { date: '2026-11-23' },
      context(),
    );
    expect(result.output).toMatchObject({ closed: true });
  });

  it('uses the shared availability service', async () => {
    const loadAvailability = vi
      .fn()
      .mockResolvedValue([
        { start_time: '12:00:00', remaining: 1, requestable: false },
      ]);
    const result = await executeAssistantTool(
      'check_availability',
      { date: '2026-11-20', time: '12:00', party_size: 5 },
      context({ loadAvailability }),
    );
    expect(loadAvailability).toHaveBeenCalledWith('2026-11-20', 5);
    expect(result.output).toMatchObject({
      times: [{ time: '12:00', remaining: 1 }],
      seatSize: 6,
    });
  });

  it('takes cart names and prices from menu data', async () => {
    const menu = loadMenu();
    const source = menu.find((item) => item.id === 'PH0001')!;
    const result = await executeAssistantTool(
      'propose_cart_add',
      { items: [{ id: 'PH0001', qty: 2, note: 'Model supplied note' }] },
      context({ menu }),
    );
    expect(result.actions).toEqual([
      {
        type: 'cart_add',
        items: [
          { id: source.id, name: source.name, qty: 2, price: source.price_usd },
        ],
      },
    ]);
  });

  it('returns safe, specific reasons for unknown and unavailable items', async () => {
    const menu = loadMenu();
    const unavailable = { ...menu[0]!, available: false };
    const missing = await executeAssistantTool(
      'propose_cart_add',
      { items: [{ id: 'PH9999', qty: 1 }] },
      context(),
    );
    const soldOut = await executeAssistantTool(
      'propose_cart_add',
      { items: [{ id: unavailable.id, qty: 1 }] },
      context({ menu: [unavailable, ...menu.slice(1)] }),
    );
    expect(missing.output).toEqual({
      error: 'That item is not on the menu.',
    });
    expect(soldOut.output).toEqual({
      error: 'That item is currently unavailable.',
    });
  });

  it('rejects merged quantities above twenty', async () => {
    const excess = await executeAssistantTool(
      'propose_cart_add',
      {
        items: [
          { id: 'PH0001', qty: 11 },
          { id: 'PH0001', qty: 10 },
        ],
      },
      context(),
    );
    expect(excess.output).toHaveProperty('error');
  });

  it('returns rule-derived booking reasons without loading availability', async () => {
    const loadAvailability = vi.fn().mockResolvedValue([]);
    const outsideWindow = await executeAssistantTool(
      'check_availability',
      { date: '2026-12-31', time: '12:00', party_size: 4 },
      context({ loadAvailability }),
    );
    const monday = await executeAssistantTool(
      'propose_booking',
      { date: '2026-11-23', time: '12:00', party_size: 4 },
      context(),
    );

    expect(outsideWindow.output).toEqual({
      error:
        'That date is outside the booking window. Bookings open up to 30 days ahead.',
    });
    expect(monday.output).toEqual({
      error: 'The café is closed on Mondays.',
    });
    expect(loadAvailability).not.toHaveBeenCalled();
  });

  it('validates proposals through booking rules', async () => {
    const valid = await executeAssistantTool(
      'propose_booking',
      { date: '2026-11-20', time: '12:00', party_size: 4 },
      context(),
    );
    const cutoff = await executeAssistantTool(
      'propose_booking',
      { date: '2026-11-18', time: '11:00', party_size: 4 },
      context(),
    );
    const large = await executeAssistantTool(
      'propose_booking',
      { date: '2026-11-20', time: '12:00', party_size: 13 },
      context(),
    );
    expect(valid.actions[0]).toMatchObject({ type: 'booking_proposal' });
    expect(cutoff.output).toHaveProperty('error');
    expect(large.actions).toEqual([{ type: 'handoff' }]);
  });

  it('logs unanswered topics and creates handoff actions without contact data', async () => {
    const logUnanswered = vi.fn().mockResolvedValue(undefined);
    const logged = await executeAssistantTool(
      'log_unanswered',
      { topic: 'Unknown policy' },
      context({ logUnanswered }),
    );
    const handoff = await executeAssistantTool(
      'handoff',
      { reason: 'Complaint' },
      context(),
    );
    expect(logUnanswered).toHaveBeenCalledWith('Unknown policy');
    expect(logged.logged).toBe(true);
    expect(handoff.actions).toEqual([{ type: 'handoff' }]);
    expect(JSON.stringify(handoff.actions)).not.toMatch(/phone|whatsapp/i);
  });
});
