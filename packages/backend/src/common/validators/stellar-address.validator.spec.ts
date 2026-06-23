import { validate } from 'class-validator';
import { IsStellarAddress } from './stellar-address.validator';

class TestDto {
  @IsStellarAddress()
  address: string;
}

async function validateAddress(address: string) {
  const dto = new TestDto();
  dto.address = address;
  return validate(dto);
}

describe('IsStellarAddress', () => {
  it('accepts a valid Stellar address', async () => {
    const errors = await validateAddress(
      'GBZNLMUQMIN3VGUJISCHKMMTNMDSYFZLHFB5BKRH2HZ7ZBYXUQYXQZWX',
    );
    expect(errors).toHaveLength(0);
  });

  it('rejects an address that does not start with G', async () => {
    const errors = await validateAddress(
      'XCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZW5BQNL3QJBA4RDHKHRD',
    );
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an address that is too short', async () => {
    const errors = await validateAddress('GCEZWKCA5');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects an empty string', async () => {
    const errors = await validateAddress('');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-string value', async () => {
    const errors = await validateAddress(123 as any);
    expect(errors.length).toBeGreaterThan(0);
  });
});
