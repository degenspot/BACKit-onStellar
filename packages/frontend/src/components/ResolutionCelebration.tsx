import React from "react";

export const ResolutionCelebration: React.FC<{ winner: string }> = ({ winner }) => {
  return (
    <div className="celebration-animation" data-testid="resolution-celebration">
      <h1>Market Resolved! Winner: {winner}</h1>
    </div>
  );
};
