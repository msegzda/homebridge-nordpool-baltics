export function getCheapestConsecutiveHours(numHours: number, pricing): number[] {
    interface HourSequence {
        startHour: number;
        total: number;
    }
    const hourSequences: HourSequence[] = [];

    for(let i = 0; i <= pricing.length - numHours; i++) {
      const totalSum = pricing.slice(i, i + numHours).reduce((total, priceObj) => total + priceObj.price, 0);
      hourSequences.push({ startHour: i, total: totalSum });
    }

    const cheapestHours = hourSequences.sort((a, b) => a.total - b.total)[0];
    const cheapestHoursList = Array.from({length: numHours}, (_, i) => cheapestHours.startHour + i);

    return cheapestHoursList;
}
