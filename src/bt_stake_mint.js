const {
  ContractInteract, Helpers, Staker, Facilitator,
} = require('@openst/brandedtoken.js');
const { Utils, ContractInteract: MosaicContractInteract } = require('@openst/mosaic.js');
const logger = require('./logger');

class BTStakeMint {
  constructor(chainConfig, connection) {
    this.chainConfig = chainConfig;
    this.origin = {
      web3: connection.originWeb3,
      chainId: chainConfig.originChainId,
      deployer: connection.originAccount.address,
      txOptions: {
        gasPrice: chainConfig.originGasPrice,
        from: connection.originAccount.address,
      },
      token: chainConfig.eip20TokenAddress,
      baseToken: chainConfig.simpleTokenAddress,
      burner: chainConfig.originBurnerAddress,
      masterKey: connection.originAccount.address,
    };

    this.auxiliary = {
      web3: connection.auxiliaryWeb3,
      chainId: chainConfig.auxiliaryChainId,
      deployer: connection.auxiliaryAccount.address,
      txOptions: {
        gasPrice: chainConfig.auxiliaryGasPrice,
        from: connection.auxiliaryAccount.address,
      },
      burner: chainConfig.auxiliaryBurnerAddress,
      masterKey: connection.auxiliaryAccount.address,
    };
  }

  async requestStakeWithGatewayComposer(
    originGatewayAddress,
    stakeVT,
    beneficiary,
    gasPrice,
    gasLimit,
  ) {
    logger.info('Started requestStake');
    const { txOptions } = this.origin;

    const brandedToken = new ContractInteract.BrandedToken(
      this.origin.web3,
      this.chainConfig.brandedToken.address,
    );
    const mintBT = await brandedToken.convertToBrandedTokens(stakeVT);

    const stakerNonce = await new MosaicContractInteract.EIP20Gateway(
      this.origin.web3,
      originGatewayAddress,
    ).getNonce(this.chainConfig.gatewayComposerAddress);

    let stakeRequest = {
      staker: this.chainConfig.gatewayComposerAddress,
      originGateway: originGatewayAddress,
      beneficiary,
      stakeVT,
      mintBT,
      stakerNonce,
      gasPrice,
      gasLimit,
    };

    const staker = new Staker(
      this.origin.web3,
      this.origin.token,
      this.chainConfig.brandedToken.address,
      this.chainConfig.gatewayComposerAddress,
    );

    // Fixme https://github.com/openst/brandedtoken.js/issues/122
    await staker.requestStake(
      stakeVT,
      mintBT,
      originGatewayAddress,
      gasPrice,
      gasLimit,
      beneficiary,
      stakerNonce,
      txOptions,
    );

    const stakeRequestHash = await brandedToken.contract.methods.stakeRequestHashes(
      this.chainConfig.gatewayComposerAddress,
    ).call();

    const { stakeRequests } = this.chainConfig;

    stakeRequest = {
      stakeRequestHash,
      ...stakeRequest,
    };
    stakeRequests[stakeRequestHash] = stakeRequest;

    logger.info(`requestStake completed, your request hash is: ${stakeRequestHash}`);
    return stakeRequestHash;
  }

  async acceptStakeWithGatewayComposer(stakeRequestHash) {
    let stakeRequest = this.chainConfig.stakeRequests[stakeRequestHash];

    const { originGateway, staker } = stakeRequest;

    await this.registerInternalActor(originGateway, stakeRequest.beneficiary);

    const signature = await this.getAcceptStakeSignature(stakeRequest);

    logger.info('acceptStake started');

    const facilitator = new Facilitator(
      this.origin.web3,
      this.origin.token,
      this.chainConfig.brandedToken.address,
      staker,
    );
    const { hashLock, unlockSecret } = Utils.createSecretHashLock();
    stakeRequest = {
      hashLock,
      unlockSecret,
      ...stakeRequest,
    };

    const eip20Gateway = new MosaicContractInteract.EIP20Gateway(this.origin.web3, originGateway);
    const bounty = await eip20Gateway.getBounty();

    await facilitator.acceptStakeRequest(
      stakeRequest.stakeRequestHash,
      signature,
      bounty,
      hashLock,
      this.origin.txOptions,
    );

    const gatewayInstance = new MosaicContractInteract.EIP20Gateway(
      this.origin.web3,
      originGateway,
    );

    logger.info('Getting message hash from the gateway');
    const activeProcess = await gatewayInstance.contract.methods.getOutboxActiveProcess(
      staker,
    ).call();

    // FixMe https://github.com/openst/mosaic.js/issues/136
    const nextNonce = await gatewayInstance.contract.methods.getNonce(
      staker,
    ).call();
    const currentNonce = parseInt(nextNonce, 10) - 1;

    // FixMe In mosaic.js facilitator.stake should return messageHash. https://github.com/openst/mosaic.js/issues/136
    const messageHash = activeProcess.messageHash_;

    const utilityBrandedTokenConfig = this.getUtilityBrandedTokenConfig(originGateway);
    const gatewayStakeRequest = {
      messageHash,
      nonce: currentNonce.toString(),
      staker,
      beneficiary: stakeRequest.beneficiary,
      amount: stakeRequest.mintBT,
      gasPrice: stakeRequest.gasPrice,
      gasLimit: stakeRequest.gasLimit,
      hashLock,
      unlockSecret,
      auxiliaryUtilityTokenAddress: utilityBrandedTokenConfig.address,
      auxiliaryOrganizationAddress: utilityBrandedTokenConfig.organizationAddress,
      originGatewayAddress: utilityBrandedTokenConfig.originGatewayAddress,
      auxiliaryCoGatewayAddress: utilityBrandedTokenConfig.auxiliaryCoGatewayAddress,
      originBrandedTokenAddress: this.chainConfig.brandedToken.address,
      originOrganizationAddress: this.chainConfig.brandedToken.originOrganization,
    };
    const { stakes, stakeRequests } = this.chainConfig;

    stakes[messageHash] = gatewayStakeRequest;
    delete stakeRequests[stakeRequestHash];

    logger.info('Stake successful');
    logger.info(`Please use facilitator agent to progressStake and use this message hash : ${messageHash}`);
    return messageHash;
  }

  async requestStake(
    originGatewayAddress,
    stakeAmount,
    staker,
    beneficiary,
    gasPrice,
    gasLimit,
  ) {
    logger.info('Started requestStake');

    const brandedToken = new ContractInteract.BrandedToken(
      this.origin.web3,
      this.chainConfig.brandedToken.address,
    );
    const mintBT = await brandedToken.convertToBrandedTokens(stakeAmount);

    const stakerNonce = await new MosaicContractInteract.EIP20Gateway(
      this.origin.web3,
      originGatewayAddress,
    ).getNonce(staker);

    let stakeRequest = {
      staker,
      originGateway: originGatewayAddress,
      beneficiary,
      stakeVT: stakeAmount,
      mintBT,
      stakerNonce,
      gasPrice,
      gasLimit,
    };

    await brandedToken.requestStake(stakeAmount, { from: staker });

    const stakeRequestHash = await brandedToken.contract.methods.stakeRequestHashes(
      staker,
    ).call();

    const { stakeRequests } = this.chainConfig;

    stakeRequest = {
      stakeRequestHash,
      ...stakeRequest,
    };
    stakeRequests[stakeRequestHash] = stakeRequest;

    logger.info(`requestStake completed, your request hash is: ${stakeRequestHash}`);
    return stakeRequestHash;
  }

  async registerInternalActor(originGatewayAddress, internalActorAddress) {
    const utilityBrandedTokenConfig = this.getUtilityBrandedTokenConfig(originGatewayAddress);

    const ubtContractInstance = new ContractInteract.UtilityBrandedToken(
      this.auxiliary.web3,
      utilityBrandedTokenConfig.address,
    );

    const registerInternalActorTxOptions = {
      from: this.auxiliary.masterKey,
      gasPrice: this.auxiliary.txOptions.gasPrice,
    };

    const isAlreadyRegistered = await ubtContractInstance.contract.methods.isInternalActor(
      internalActorAddress,
    ).call();

    if (isAlreadyRegistered) {
      logger.info(`Beneficiary address ${internalActorAddress} already registered as Internal actor`);
    } else {
      await ubtContractInstance.registerInternalActors(
        [internalActorAddress],
        registerInternalActorTxOptions,
      );
      logger.info(`${internalActorAddress} address registered as Internal actor`);
    }
  }

  async getAcceptStakeSignature(stakeRequest) {
    const brandedToken = new ContractInteract.BrandedToken(
      this.origin.web3,
      this.chainConfig.brandedToken.address,
    );

    const btNonce = await brandedToken.contract.methods.nonce().call();

    const stakeRequestTypedData = new Helpers.StakeHelper().getStakeRequestTypedData(
      stakeRequest.stakeVT,
      parseInt((btNonce) - 1, 10),
      stakeRequest.staker,
      this.chainConfig.brandedToken.address,
    );
    const workerAccountInstance = this.origin.web3.eth.accounts.privateKeyToAccount(
      this.chainConfig.workerPrivateKey,
    );

    const signature = workerAccountInstance.signEIP712TypedData(stakeRequestTypedData);
    return signature;
  }

  async acceptStake(stakeRequestHash) {
    const stakeRequest = this.chainConfig.stakeRequests[stakeRequestHash];

    const { originGateway, staker } = stakeRequest;

    await this.registerInternalActor(originGateway, stakeRequest.beneficiary);

    const signature = await this.getAcceptStakeSignature(stakeRequest);

    logger.info('acceptStake started');

    const brandedToken = new ContractInteract.BrandedToken(
      this.origin.web3,
      this.chainConfig.brandedToken.address,
    );

    await brandedToken.acceptStakeRequest(
      stakeRequest.stakeRequestHash,
      signature.r,
      signature.s,
      signature.v,
      this.origin.txOptions,
    );

    const { stakeRequests } = this.chainConfig;

    delete stakeRequests[stakeRequestHash];

    const utilityBrandedTokenConfig = this.getUtilityBrandedTokenConfig(originGateway);
    const stakeInfo = {
      staker,
      beneficiary: stakeRequest.beneficiary,
      amount: stakeRequest.mintBT,
      gasPrice: stakeRequest.gasPrice,
      gasLimit: stakeRequest.gasLimit,
      auxiliaryUtilityTokenAddress: utilityBrandedTokenConfig.address,
      auxiliaryOrganizationAddress: utilityBrandedTokenConfig.organizationAddress,
      originGatewayAddress: utilityBrandedTokenConfig.originGatewayAddress,
      auxiliaryCoGatewayAddress: utilityBrandedTokenConfig.auxiliaryCoGatewayAddress,
      originBrandedTokenAddress: this.chainConfig.brandedToken.address,
      originOrganizationAddress: this.chainConfig.brandedToken.originOrganization,
    };

    logger.info('acceptStake completed.');
    return stakeInfo;
  }

  getUtilityBrandedTokenConfig(originGateway) {
    return this.chainConfig.utilityBrandedTokens.find(
      ut => ut.originGatewayAddress === originGateway,
    );
  }
}

module.exports = BTStakeMint;
