var expect = require('expect');
var OptionsContract = artifacts.require("../contracts/OptionsContract.sol");
var OptionsFactory = artifacts.require("../contracts/OptionsFactory.sol");
var OptionsExchange = artifacts.require("../contracts/OptionsExchange.sol");
var CompoundOracle = artifacts.require("../contracts/lib/MockCompoundOracle.sol");
var UniswapFactory = artifacts.require("../contracts/lib/MockUniswapFactory.sol");
var daiMock = artifacts.require("../contracts/lib/simpleERC20.sol");
var { ContractCreated }= require('./utils/FactoryEvents.js')

const truffleAssert = require('truffle-assertions');

// Initialize the Options Factory, Options Exchange and other mock contracts
contract('OptionsContract', (accounts) => {
  var creatorAddress = accounts[0];
  var firstOwnerAddress = accounts[1];
  var secondOwnerAddress = accounts[2];
  var externalAddress = accounts[3];
  var unprivilegedAddress = accounts[4]
  /* create named accounts for contract roles */

  let optionsContracts;
  let optionsFactory;
  let optionsExchange;
  let dai;

  before(async () => {
      // 1. Deploy mock contracts
      // 1.1 Compound Oracle
      var compoundOracle = await CompoundOracle.deployed();
      // 1.2 Uniswap Factory
      var uniswapFactory = await UniswapFactory.deployed();
      // 1.3 Mock Dai contract
      dai = await daiMock.deployed();
      await dai.mint("10000000");
      // 2. Deploy our contracts
      // deploys the Options Exhange contract
      optionsExchange = await OptionsExchange.deployed();

      // TODO: remove this later. For now, set the compound Oracle and uniswap Factory addresses here.
      await optionsExchange.setUniswapAndCompound(uniswapFactory.address, compoundOracle.address);

      // Deploy the Options Factory contract and add assets to it
      optionsFactory = await OptionsFactory.deployed();
      await optionsFactory.setOptionsExchange(optionsExchange.address);

      await optionsFactory.addAsset(
        "DAI",
        dai.address
      );
      // TODO: deploy a mock USDC and get its address
      await optionsFactory.addAsset(
      "USDC",
      "0xB5D0545dF2649359B1F91679f64812dc70Bfd547"
      );

      // Create the unexpired options contract
      var optionsContractResult = await optionsFactory.createOptionsContract(
        "ETH",
        -"18",
        "DAI",
        -"17",
        "90",
        -"18",
        "ETH",
        "1577836800",
        "1577836800"
      );

      var optionsContractAddr = optionsContractResult.logs[0].args[0];
      optionsContracts = [await OptionsContract.at(optionsContractAddr)];

      // create the expired options contract
      optionsContractResult = await optionsFactory.createOptionsContract(
        "ETH",
        -"18",
        "DAI",
        -"17",
        "90",
        -"18",
        "ETH",
        "1",
        "1"
      );

      const expiredOptionsAddr = optionsContractResult.logs[0].args[0];
      const expiredOptionsContract = await OptionsContract.at(expiredOptionsAddr);
      optionsContracts.push(expiredOptionsContract);

      optionsContractResult = await optionsFactory.createOptionsContract(
        "DAI",
        -"18",
        "ETH",
        -"17",
        "90",
        -"18",
        "ETH",
        "1577836800",
        "1577836800"
      );

      optionsContractAddr = optionsContractResult.logs[0].args[0];
      const ERC20collateralOptContract = await OptionsContract.at(optionsContractAddr);
      optionsContracts.push(ERC20collateralOptContract);

  });

  describe("#openRepo()", () => {
    it("should open first repo correctly", async () => {
      var result = await optionsContracts[0].openRepo({from: creatorAddress, gas: '100000'})
      var repoIndex = "0";

      // test getReposByOwner
      var repos = await  optionsContracts[0].getReposByOwner(creatorAddress);
      expect(repos).toHaveLength(1);
      expect(repos[0].toNumber()).toEqual(0);

      // test getRepoByIndex
      var repo = await optionsContracts[0].getRepoByIndex(repoIndex);
      expect(repo['0'].toNumber()).toEqual(0);
      expect(repo['1'].toNumber()).toEqual(0);
      expect(repo['2']).toEqual(creatorAddress);
    })

    it("should open second repo correctly", async () => {

      var result = await  optionsContracts[0].openRepo({from: creatorAddress, gas: '100000'})
      var repoIndex = "1";

       // test getReposByOwner
       var repos = await optionsContracts[0].getReposByOwner(creatorAddress);
       const expectedRepos =[ '0', '1' ]
       expect(repos).toMatchObject(expectedRepos);

       // test getRepoByIndex
       var repo = await optionsContracts[0].getRepoByIndex(repoIndex);
       const expectedRepo = {
         '0': '0',
         '1': '0',
         '2': creatorAddress }
       expect(repo).toMatchObject(expectedRepo);
    })

    it("new person should be able to open third repo correctly", async () => {

      var result = await  optionsContracts[0].openRepo({from: firstOwnerAddress, gas: '100000'})
      var repoIndex = "2";

       // test getReposByOwner
       var repos = await optionsContracts[0].getReposByOwner(firstOwnerAddress);
       const expectedRepos =[ '2' ]
       expect(repos).toMatchObject(expectedRepos);

       // test getRepoByIndex
       var repo = await optionsContracts[0].getRepoByIndex(repoIndex);
       const expectedRepo = {
         '0': '0',
         '1': '0',
         '2': firstOwnerAddress }
       expect(repo).toMatchObject(expectedRepo);
    })

    it("should check for proper events emitted during all open repo calls", async () => {
            // Opening should Emit an event correctly
            var returnValues = (await optionsContracts[0].getPastEvents( 'RepoOpened', { fromBlock: 0, toBlock: 'latest' } ))
            var repoIndex = returnValues[0].returnValues.repoIndex;
            expect(repoIndex).toBe("0");
            repoIndex = returnValues[1].returnValues.repoIndex;
            expect(repoIndex).toBe("1");
            repoIndex = returnValues[2].returnValues.repoIndex;
            expect(repoIndex).toBe("2");
    })

    it("should not be able to open a repo in an expired options contract", async () => {
      try{
        var result = await  optionsContracts[1].openRepo({from: firstOwnerAddress, gas: '100000'})
      } catch (err) {
        return;
      }

      truffleAssert.fails("should throw error");
    })

  });

  describe("#addETHCollateral()", () => {


    it("should add ETH collateral successfully", async () => {
      const repoNum = 1;
      var msgValue = "10000000";
      var result = await  optionsContracts[0].addETHCollateral(repoNum,{from: creatorAddress, gas: '100000', value: msgValue})

      // test that the repo's balances have been updated.
      var repo = await optionsContracts[0].getRepoByIndex(repoNum);
      const expectedRepo = {
        '0': '10000000',
        '1': '0',
        '2': creatorAddress }
      expect(repo).toMatchObject(expectedRepo);

    })

    it("anyone should be able to add ETH collateral to any repo", async()=> {
      const repoNum = 1;
      var msgValue = "10000000";
      var result = await  optionsContracts[0].addETHCollateral(repoNum,{from: firstOwnerAddress, gas: '100000', value: msgValue})

      // test that the repo's balances have been updated.
      var repo = await optionsContracts[0].getRepoByIndex(repoNum);
      const expectedRepo = {
        '0': '20000000',
        '1': '0',
        '2': creatorAddress }
      expect(repo).toMatchObject(expectedRepo);
    })

    it("add ETH events should be emitted", async () => {
      // Adding ETH should emit an event correctly
      var returnValues = (await optionsContracts[0].getPastEvents( 'ETHCollateralAdded', { fromBlock: 0, toBlock: 'latest' } ));
      var repoIndex1 = returnValues[0].returnValues.repoIndex;
      var amount = returnValues[0].returnValues.amount;
      expect(repoIndex1).toBe("1");
      expect(amount).toBe("10000000");

      repoIndex1 = returnValues[1].returnValues.repoIndex;
      amount = returnValues[1].returnValues.amount;
      expect(repoIndex1).toBe("1");
      expect(amount).toBe("10000000");
    })

    it("should not be able to add ETH collateral to an expired options contract", async () => {
      try{
        const repoNum = 1;
        var msgValue = "10000000";
        var result = await  optionsContracts[1].addETHCollateral(repoNum,{from: firstOwnerAddress, gas: '100000', value: msgValue})
      } catch (err) {
        return;
      }
      truffleAssert.fails("should throw error");
    })

  });

  describe("#addERC20Collateral()", () => {

    it("should open ERC20 repo correctly", async () => {
      var result = await  optionsContracts[2].openRepo({from: creatorAddress, gas: '100000'})
      var repoIndex = "0";

      // test getReposByOwner
      var repos = await optionsContracts[2].getReposByOwner(creatorAddress);
      const expectedRepos =[ '0' ]
      expect(repos).toMatchObject(expectedRepos);

      // test getRepoByIndex
      var repo = await optionsContracts[2].getRepoByIndex(repoIndex);
      const expectedRepo = {
        '0': '0',
        '1': '0',
        '2': creatorAddress }
      expect(repo).toMatchObject(expectedRepo);

    })

    it("should add ERC20 collateral successfully", async () => {
      const repoNum = 0;
      var msgValue = "10000000";
      await dai.approve(optionsContracts[2]._address, "10000000000000000");
      var result = await  optionsContracts[2].addERC20Collateral(repoNum, msgValue,{from: creatorAddress, gas: '1000000'})

      // Adding ETH should emit an event correctly
      var returnValues = (await optionsContracts[2].getPastEvents( 'ERC20CollateralAdded', { fromBlock: 0, toBlock: 'latest' } ))[0].returnValues;
      var repoIndex1 = returnValues.repoIndex;
      var amount = returnValues.amount;
      expect(repoIndex1).toBe("0");
      expect(amount).toBe(msgValue);

      // test that the repo's balances have been updated.
      var repo = await optionsContracts[2].getRepoByIndex("0");
      const expectedRepo = {
        '0': msgValue,
        '1': '0',
        '2': creatorAddress }
      expect(repo).toMatchObject(expectedRepo);

    })

    it("should not be able to add ERC20 collateral to non-ERC20 collateralized options contract", async () => {
      try{
        const repoNum = 1;
        var msgValue = "10000000";
        var result = await  optionsContracts[0].addERC20Collateral(repoNum,{from: firstOwnerAddress, gas: '100000', value: msgValue})
      } catch (err) {
        return;
      }
      truffleAssert.fails("should throw error");
    })

    it("should not be able to add ETH collateral to non-ETH collateralized options contract", async () => {
      try{
        const repoNum = 0;
        var msgValue = "10000000";
        var result = await  optionsContracts[2].addETHCollateral(repoNum,{from: firstOwnerAddress, gas: '100000', value: msgValue})
      } catch (err) {
        return;
      }
      truffleAssert.fails("should throw error");
    })

  });

  describe("#issueOptionTokens()", () => {
    it("should allow you to mint correctly", async () => {

      const repoIndex = "1";
      const numTokens = "138888";

      var result = await  optionsContracts[0].issueOptionTokens(repoIndex, numTokens,{from: creatorAddress, gas: '100000'});
      var amtPTokens = await optionsContracts[0].balanceOf(creatorAddress);
      expect(amtPTokens).toBe(numTokens);
    })

    it ("should emit events correctly", async () => {
      var returnValues = (await optionsContracts[0].getPastEvents( 'IssuedOptionTokens', { fromBlock: 0, toBlock: 'latest' } ))[0].returnValues;
      var personIssuedTo = returnValues.issuedTo;
      expect(personIssuedTo).toBe(creatorAddress);
    })

    it("only owner should of repo should be able to mint", async () => {
      const repoIndex = "1";
      const numTokens = "100";
      try {
        var result = await  optionsContracts[0].issueOptionTokens(repoIndex, numTokens,{from: firstOwnerAddress, gas: '100000'});
      } catch (err) {
        return;
      }
      truffleAssert.fails("should throw error");

      // the balance of the contract caller should be 0. They should not have gotten tokens.
      var amtPTokens = await optionsContracts[0].balanceOf(firstOwnerAddress);
      console.log(amtPTokens);
      expect(amtPTokens).toBe("0");

    })

    it ("should only allow you to mint tokens if you have sufficient collateral", async () => {
      const repoIndex = "1";
      const numTokens = "2";
      try {
        var result = await  optionsContracts[0].issueOptionTokens(repoIndex, numTokens,{from: creatorAddress, gas: '100000'});
      } catch (err) {
        return;
      }

      truffleAssert.fails("should throw error");

      // the balance of the contract caller should be 0. They should not have gotten tokens.
      var amtPTokens = await optionsContracts[0].balanceOf(creatorAddress);
      expect(amtPTokens).toBe("138888");
    })
    it("should not be able to issue tokens after expiry", async ()=> {

    })

  });

  describe('#burnPutTokens()', () => {
    it("should be able to burn put tokens", async () => {
      const repoIndex = "1";
      const numTokens = "10";

      var result = await  optionsContracts[0].burnPutTokens(repoIndex, numTokens,{from: creatorAddress, gas: '100000'});
      var amtPTokens = await optionsContracts[0].balanceOf(creatorAddress);
      expect(amtPTokens).toBe("138878");
    })

    // it("correct events should be emitted", async () => {

    // }) 
    it("only owner should be able to burn tokens", async () => {
      var transferred = await optionsContracts[0].transfer(firstOwnerAddress, "10",{from: creatorAddress, gas: '100000'});
      var amtPTokens = await optionsContracts[0].balanceOf(firstOwnerAddress);
      expect(amtPTokens).toBe("10");

      const repoIndex = "1";
      const numTokens = "10";

      try {
      var result = await  optionsContracts[0].burnPutTokens(repoIndex, numTokens,{from: firstOwnerAddress, gas: '100000'});
      } catch (err) {
        return;
      }

      truffleAssert.fails("should throw error");
  })

  })

  describe('#removeCollateral()', () => {
    it("should be able to remove collateral if sufficiently collateralized", async () => {
      const repoIndex = "1";
      const numTokens = "1000";

      var result = await  optionsContracts[0].removeCollateral(repoIndex, numTokens,{from: creatorAddress, gas: '100000'});

      // Check the contract correctly updated the repo
      var repo = await optionsContracts[0].getRepoByIndex(repoIndex);
      const expectedRepo = {
        '0': '19999000',
        '1': '138878',
        '2': creatorAddress }
      expect(repo).toMatchObject(expectedRepo);

      // Check that the owner correctly got their collateral back. 
    })

    it("only owner should be able to remove collateral", async () => {

      try {
        var result = await  optionsContracts[0].removeCollateral(repoIndex,"10",{from: firstOwnerAddress, gas: '100000'});
        } catch (err) {
          return;
        }

        truffleAssert.fails("should throw error");
    })

    it("should be able to remove more collateral if sufficient collateral", async () => {
      const repoIndex = "1";
      const numTokens = "500";

      var result = await  optionsContracts[0].removeCollateral(repoIndex, numTokens,{from: creatorAddress, gas: '100000'});

      // Check the contract correctly updated the repo
      var repo = await optionsContracts[0].getRepoByIndex(repoIndex);
      const expectedRepo = {
        '0': '19998500',
        '1': '138878',
        '2': creatorAddress }
      expect(repo).toMatchObject(expectedRepo);
    })

    it("should not be able to remove collateral if not sufficient collateral", async () => {
      try {
        var result = await  optionsContracts[0].removeCollateral(repoIndex,"5",{from: creatorAddress, gas: '100000'});
        } catch (err) {
          return;
        }

        truffleAssert.fails("should throw error");

        // check that the collateral in the repo remains the same
        var repo = await optionsContracts[0].getRepoByIndex(repoIndex);
        const expectedRepo = {
          '0': '19999000',
          '1': '138878',
          '2': creatorAddress }
        expect(repo).toMatchObject(expectedRepo);
    })

    it("should not be able to remove collateral after expiry", async () => {

    })

  })

});