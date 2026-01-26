"use client";

type ConditionType = "TARGET" | "PERCENT" | "RANGE";

export default function ConditionBuilder({
  value,
  onChange,
}: {
  value: any;
  onChange: (val: any) => void;
}) {
  const type: ConditionType = value.type;

  return (
    <div className="space-y-3">
      <select
        className="border p-2 w-full"
        value={type}
        onChange={(e) => onChange({ type: e.target.value })}
      >
        <option value="TARGET">Target Price</option>
        <option value="PERCENT">Percent Move</option>
        <option value="RANGE">Range</option>
      </select>

      {type === "TARGET" && (
        <input
          type="number"
          placeholder="Target price"
          className="border p-2 w-full"
          onChange={(e) => onChange({ ...value, target: +e.target.value })}
        />
      )}

      {type === "PERCENT" && (
        <input
          type="number"
          placeholder="Percent change"
          className="border p-2 w-full"
          onChange={(e) => onChange({ ...value, percent: +e.target.value })}
        />
      )}

      {type === "RANGE" && (
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="Min"
            className="border p-2 w-full"
            onChange={(e) => onChange({ ...value, min: +e.target.value })}
          />
          <input
            type="number"
            placeholder="Max"
            className="border p-2 w-full"
            onChange={(e) => onChange({ ...value, max: +e.target.value })}
          />
        </div>
      )}
    </div>
  );
}
