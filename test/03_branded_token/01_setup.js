// 'use strict';

const shared = require('../shared');
const BTDeployer = require('../../src/bt_deployer.js');
const config = require('../config');

describe('Setup Branded token', async () => {
  let btDeployer;

  it('deploy branded token', async () => {
    const { chainConfig, connection } = shared;
    btDeployer = new BTDeployer(chainConfig, connection);

    const symbol = 'JLP';
    const name = 'JLP';
    const decimal = config.decimals;
    // As per below conversion rate: 1 OST = 2 BT
    const conversionRate = 200000;
    const conversionDecimal = 5;

    const { originOrganization, brandedToken } = await btDeployer.deployBrandedToken(
      symbol,
      name,
      decimal,
      conversionRate,
      conversionDecimal,
    );

    chainConfig.originOrganizationAddress = originOrganization.address;
    chainConfig.brandedToken = {
      address: brandedToken.address,
      symbol,
      name,
      decimal,
      conversionRate,
      conversionDecimal,
      originOrganization: originOrganization.address,
      valueToken: chainConfig.eip20TokenAddress,
    };
  });

  it('deploy utility branded token', async () => {
    // Below line will throw an exception if anything fails, which will
    // result in test failure. Hence no need of explicit assertion.
    await btDeployer.deployUtilityBrandedToken();
  });
});
