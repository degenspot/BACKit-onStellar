export class PerpetualMarketService {
  calculateFundingRate(longInterest: number, shortInterest: number) {
    if (longInterest === shortInterest) return 0;
    return (longInterest - shortInterest) / (longInterest + shortInterest) * 0.01;
  }
}
