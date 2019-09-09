const Market = require('./Market.js');
const ccxt = require ('ccxt');

module.exports = class HitBTC extends Market {
  constructor(w3, exchangeId) {
    super(w3);

    this.market  = new ccxt[exchangeId];
  }

  async getRate(currency_from, currency_to, decimals) {
    const pair = await this.market.fetchTicker(currency_from + '/' + currency_to);

    const rate = this.toEquivalent(pair.info.last, decimals);

    return rate;
  }

};
