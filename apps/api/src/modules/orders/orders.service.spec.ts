import { mapOrderStatus } from './orders.service';

describe('mapOrderStatus', () => {
  it('Trendyol durumlarını eşler', () => {
    expect(mapOrderStatus('Created')).toBe('NEW');
    expect(mapOrderStatus('Picking')).toBe('PICKING');
    expect(mapOrderStatus('Invoiced')).toBe('PACKED');
    expect(mapOrderStatus('Shipped')).toBe('SHIPPED');
    expect(mapOrderStatus('AtCollectionPoint')).toBe('SHIPPED');
    expect(mapOrderStatus('Delivered')).toBe('DELIVERED');
    expect(mapOrderStatus('Cancelled')).toBe('CANCELLED');
    expect(mapOrderStatus('UnSupplied')).toBe('CANCELLED');
    expect(mapOrderStatus('Returned')).toBe('RETURNED');
  });
  it('bilinmeyen durumu gizlemez', () => {
    expect(mapOrderStatus('Weird')).toBe('UNKNOWN');
  });
});
