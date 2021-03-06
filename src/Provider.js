const MarketsManager = require('./MarketsManager.js');
const env = require('../environment.js');
const storage = require('node-persist');

module.exports = class Provider {
  constructor(w3, oracleFactory, oracles) {
    this.w3 = w3;
    this.oracleFactory = oracleFactory;
    this.oracles = oracles;
    this.MarketsManager = null;
    this.ratesProvided = [];
    this.oracleSymbols = env.oracles;
    this.primaryCurrency = env.primaryCurrency;
    this.ratesToProvide = [];
    this.provideAll = false;
  }

  bn(number) {
    return this.w3.utils.toBN(number);
  }

  toUint96(number) {
    const hex = number.toString(16);
    return `0x${'0'.repeat(24 - hex.length)}${hex}`;
  }

  logRates(providedData, signer) {
    for (var currencyData of providedData) {
      const log = 'Provide(signer: ' + signer.address + ',  oracle: ' + currencyData.oracle + ',  rate: ' + currencyData.rate + ')';
      console.log(log);
    }
  }

  logRatesToProvide() {
    console.log('\n');
    for (var provideRate of this.ratesToProvide) {
      const log = 'Providing Median Rate for ' + this.primaryCurrency + '/' + provideRate.symbol + ': ' + provideRate.rate;
      console.log(log);
    }
  }

  logMarketMedianRates() {
    for (var currencyData of this.ratesProvided) {
      const log = 'Median Rate ' + currencyData.currency_from + '/' + currencyData.currency_to + ': ' + currencyData.rate + ' from markets: ' + currencyData.markets;
      console.log(log);
    }
  }

  async init() {
    this.MarketsManager = await new MarketsManager(this.w3).init();
    return this;
  }

  async getMedian(rates) {
    var median = 0, rateLen = rates.length;

    if (!rateLen)
      return undefined;

    rates.sort();

    if (rateLen % 2 === 0) {
      const num1 = this.bn(rates[this.bn(rateLen).div(this.bn(2)) - 1]);
      const num2 = this.bn(rates[this.bn(rateLen).div(this.bn(2))]);

      median = (num1.add(num2)).div(this.bn(2)).toString();
    } else {
      median = rates[(rateLen - 1) / 2];
    }

    return median;
  }

  async getMedianFromMarkets(currencydata) {

    console.log('Getting ' + currencydata.currency_from + '/' + currencydata.currency_to + ' rates...');

    const marketManager = this.MarketsManager;

    let rates = [];

    // Get median from market rates
    for (var exchange of currencydata.exchangesIds) {
      const rateData = {
        currency_from: currencydata.currency_from,
        currency_to: currencydata.currency_to,
        exchangeId: exchange,
        decimals: currencydata.decimals
      };

      const rate = await marketManager.getRate(rateData);
      if (rate) {
        rates.push(rate);
      } else {
        console.log('Wrong rate: ' + rate);
      }
    }
    const medianRate = await this.getMedian(rates);
    if (!medianRate) {
      console.log('Dont have rates');
      return;
    }

    console.log('Median Rate ' + currencydata.currency_from + '/' + currencydata.currency_to + ': ' + medianRate + '\n');

    const rateProvided = {
      currency_from: currencydata.currency_from,
      currency_to: currencydata.currency_to,
      rate: medianRate,
      markets: currencydata.exchangesIds,
      decimals: currencydata.decimals
    };

    this.ratesProvided.push(rateProvided);
  }

  async getMarketsRates(data) {

    console.log('Gathering Market data...');

    for (var pair of data) {
      await this.getMedianFromMarkets(pair);
    }
  }

  async getPairsFrom(to) {
    const marketRates = this.ratesProvided;
    let pairsFrom = [];

    for (var mkr of marketRates) {
      if (mkr.currency_to == to) {
        pairsFrom.push(mkr.currency_from);
      }
    }
    return pairsFrom;
  }

  async getPairsTo(from) {
    const marketRates = this.ratesProvided;
    let pairsTo = [];

    for (var mkr of marketRates) {
      if (mkr.currency_from == from) {
        pairsTo.push(mkr.currency_to);
      }
    }
    return pairsTo;
  }

  async getPair(from, to) {
    const marketRates = this.ratesProvided;

    for (var mkr of marketRates) {
      if (mkr.currency_from == from && mkr.currency_to == to) {
        return mkr;
      }
      if (mkr.currency_from == to && mkr.currency_to == from) {
        return mkr;
      }
    }
    return {};
  }

  async getIntersection(pairsToPrimary, pairsFromSymbol) {
    const matchCurrency = pairsToPrimary.filter(c => pairsFromSymbol.includes(c));
    return matchCurrency;
  }

  async getIndirectRate(symbol) {
    const pairsToPrimary = await this.getPairsTo(this.primaryCurrency);
    const pairsFromSymbol = await this.getPairsFrom(symbol);
    const pairsToSymbol = await this.getPairsTo(symbol);
    let matchPairTo = false;

    let getIntersection = await this.getIntersection(pairsToPrimary, pairsFromSymbol);

    if (getIntersection.length == 0) {
      getIntersection = await this.getIntersection(pairsToPrimary, pairsToSymbol);
      matchPairTo = true;
    }

    if (getIntersection.length > 0) {
      const matchSymbol = getIntersection[0];
      const ratePrimary = await this.getPair(this.primaryCurrency, matchSymbol);
      const rateSymbol = await this.getPair(matchSymbol, symbol);
      let medianRate;

      if (!matchPairTo) {
        medianRate = this.bn(ratePrimary.rate).mul(this.bn(rateSymbol.rate)).div(this.bn(10 ** rateSymbol.decimals)).toString();
      } else {
        medianRate = this.bn(ratePrimary.rate).mul(this.bn(10 ** rateSymbol.decimals)).div(this.bn(rateSymbol.rate)).toString();
      }
      return medianRate;
    } else {
      for (var cp of pairsToPrimary) {
        for (var cs of pairsFromSymbol) {
          const pair = await this.getPair(cp, cs);
          if (pair.rate != undefined) {
            const primaryRate = await this.getPair(this.primaryCurrency, cp);
            const symbolRate = await this.getPair(cs, symbol);
            const intermidateRate = pair.rate;

            const medianRate = this.bn(primaryRate.rate).mul(this.bn(symbolRate.rate)).mul(this.bn(intermidateRate)).toString();
            const medianRateDecimals = this.bn(medianRate).div(this.bn(10 ** symbolRate.decimals)).div(this.bn(10 ** pair.decimals)).toString();
            return medianRateDecimals;
          }
        }
      }
    }

    const err = '';
    return err;
  }


  async getOraclesRatesData() {
    let ratesProvidedData = [];

    for (var symbol of this.oracleSymbols) {
      let medianRate;

      // Check currency
      if (!this.oracles[symbol]) {
        console.log('Wrong currency: ' + symbol);
      }
      // Check address
      const address = this.oracles[symbol]._address;
      if (!address) {
        console.log('Wrong address: ' + address);
      }

      const directRate = await this.getPair(this.primaryCurrency, symbol);
      let percentageChanged;

      if (directRate.rate != undefined) {
        // Get direct rate
        medianRate = directRate.rate;
        percentageChanged = await this.checkPercentageChanged(symbol, medianRate);

        if (this.provideAll || percentageChanged) {
          const rateProvided = `${this.toUint96(Number(medianRate))}${address.replace('0x', '')}`;
          ratesProvidedData.push(rateProvided);
        }
      } else {
        // Get indirect rate
        medianRate = await this.getIndirectRate(symbol);
        percentageChanged = await this.checkPercentageChanged(symbol, medianRate);

        if (medianRate !== '') {
          if (this.provideAll || percentageChanged) {
            const rateProvided = `${this.toUint96(Number(medianRate))}${address.replace('0x', '')}`;
            ratesProvidedData.push(rateProvided);
          }
        } else {
          console.log('Cannot get median Rate: ' + this.primaryCurrency + '/' + symbol);
        }

      }

      if (this.provideAll || percentageChanged) {
        const symbolMedianRate = {
          symbol: symbol,
          oracle: address,
          rate: medianRate
        };

        this.ratesToProvide.push(symbolMedianRate);
      }
    }
    return ratesProvidedData;
  }


  async persistRates(ratesToProvide) {
    for (var currency of ratesToProvide) {
      await storage.setItem(currency.symbol, currency.rate);
    }
  }

  async checkPercentageChanged(symbol, newRate) {
    let abruptRateChanged = false;

    const pr = await storage.getItem(symbol);
    console.log('currency', symbol);

    if (pr) {
      let percentageChanged;
      if (pr >= newRate) {
        percentageChanged = (1 - (newRate / pr)) * 100;
      } else {
        percentageChanged = ((newRate / pr) - 1) * 100;
      }
      console.log('Percentage Changed', percentageChanged.toString());

      if (percentageChanged > env.percentageChange) {
        // Update rate, add to send in tx
        abruptRateChanged = true;
      }
    }
    console.log(abruptRateChanged);
    return abruptRateChanged;
  }


  async provideRates(signer, provideAll) {
    this.ratesProvided = [];
    this.ratesToProvide = [];
    this.provideAll = provideAll;
    let provideOneOracle;
    let provideOneRate;
    let gasEstimate;

    await this.getMarketsRates(signer.data);
    this.logMarketMedianRates();

    const oraclesRatesData = await this.getOraclesRatesData();
    this.logRatesToProvide();

    if (oraclesRatesData.length > 0) {
      const gasPrice = await this.w3.eth.getGasPrice();
      if (oraclesRatesData.length == 1) {
        provideOneOracle = this.ratesToProvide[0].oracle;
        provideOneRate = this.ratesToProvide[0].rate;
        gasEstimate = await this.oracleFactory.methods.provide(provideOneOracle, provideOneRate).estimateGas(
          { from: signer.address }
        );
      } else {
        gasEstimate = await this.oracleFactory.methods.provideMultiple(oraclesRatesData).estimateGas(
          { from: signer.address }
        );
      }

      // 10% more than gas estimate
      const moreGasEstimate = (gasEstimate * 1.1).toFixed(0);

      console.log('Starting send transaction with marmo...');

      try {
        let tx;
        if (oraclesRatesData.length == 1) {
          tx = await this.oracleFactory.methods.provide(provideOneOracle, provideOneRate).send(
            { from: signer.address, gas: moreGasEstimate, gasPrice: gasPrice }
          );
        } else {
          tx = await this.oracleFactory.methods.provideMultiple(oraclesRatesData).send(
            { from: signer.address, gas: moreGasEstimate, gasPrice: gasPrice }
          );
        }

        this.logRates(this.ratesToProvide, signer);

        await this.persistRates(this.ratesToProvide);

        console.log('txHash: ' + tx.transactionHash);
      } catch (e) {
        console.log(' Error message: ' + e.message);
      }

    } else {
      console.log('No rates changed > 1 %');
    }
  }
};
