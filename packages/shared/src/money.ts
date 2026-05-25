export interface Money {
  amount: bigint;
  currency: string;
}

export function toMinorUnits(major: number): bigint {
  return BigInt(Math.round(major * 100));
}

export function fromMinorUnits(minor: bigint): number {
  return Number(minor) / 100;
}
