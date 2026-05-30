export type TokenPair = {
  symbol: string;
  name: string;
  base: string;
  quote: string;
  price: number;
  change24h: number;
};

export type ConditionType = "TARGET" | "PERCENT" | "RANGE";

export type ConditionForm = {
  type: ConditionType;
  comparator: "ABOVE" | "BELOW";
  targetPrice: string;
  direction: "UP" | "DOWN";
  percentChange: string;
  rangeMin: string;
  rangeMax: string;
};

export type CreateCallFormData = {
  tokenPair: TokenPair | null;
  condition: ConditionForm;
  thesis: string;
  stakeAmount: string;
  stakeToken: string;
  expiry: string;
};

export type StepErrors = Record<string, string>;

export const DEFAULT_CONDITION: ConditionForm = {
  type: "TARGET",
  comparator: "ABOVE",
  targetPrice: "",
  direction: "UP",
  percentChange: "",
  rangeMin: "",
  rangeMax: "",
};
