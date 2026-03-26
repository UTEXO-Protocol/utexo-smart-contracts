import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/src/signers';
import { TypedDataDomain, HDNodeWallet } from 'ethers';
import {
    Bridge,
    TestToken,
    BridgeContractProxyAdmin,
    TransparentProxy,
    MockContractV1,
    MultisigProxy,
} from '../typechain-types';
import { getCurrentTimeFromNetwork } from './util';
import { signFundsIn, signFundsInNative } from './helpers/bridge-setup';
import {
    buildBitmapAndSignatures,
    BridgeOperationTypes,
    EmergencyPauseTypes,
    EmergencyUnpauseTypes,
} from './helpers/multisig-helpers';

describe('Bridge Negative Cases test', function () {
    let bridgeContract: Bridge;
    let multisigProxy: MultisigProxy;
    let tokenContract: TestToken;
    let tokenContract2: TestToken;

    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let commissionCollector: SignerWithAddress;

    let teeSigner: HDNodeWallet;
    let federationSigner: HDNodeWallet;
    let domain: TypedDataDomain;

    const initialSupply = ethers.parseEther('10000');
    const amountToTransfer = ethers.parseEther('1000');
    const testCommission = ethers.parseEther('140'); // Pre-calculated commission
    const destinationChain = 'Solana';
    const destinationAddress = '4zXwdbUDWo1S5AP2CEfv4zAPRds5PQUG1dyqLLvib2xu';
    const emptyAddress = '0x0000000000000000000000000000000000000000';
    const emptyDestinationAddress = '';
    const emptyDestinationChain = '';
    const bridgeInTransactionId = 111;
    const bridgeOutTransactionId = 1011;
    let chainId: bigint;

    const getAmountToReturnAndTotalCommission = () => {
        const totalCommission = testCommission;
        const amountToReturn = amountToTransfer - totalCommission;
        return [totalCommission, amountToReturn];
    };

    /**
     * Helper: encode Bridge callData and forward it through MultisigProxy.execute()
     * using the TEE signer (enclave signer at index 0).
     */
    async function executeOnBridge(callData: string) {
        // extract selector from callData (first 4 bytes = 8 hex chars + '0x' prefix)
        const selectorBytes4 = callData.slice(0, 10) as string;

        const nonce = await multisigProxy.nonces(selectorBytes4 as any);
        const deadline = (await getCurrentTimeFromNetwork()) + 3600;

        const { bitmap, signatures } = await buildBitmapAndSignatures(
            [teeSigner],
            [0],
            domain,
            BridgeOperationTypes,
            {
                selector: selectorBytes4,
                callData: callData,
                nonce: nonce,
                deadline: deadline,
            }
        );

        return multisigProxy.execute(callData, nonce, deadline, bitmap, signatures);
    }

    this.beforeEach(async () => {
        // @ts-ignore
        [owner, user1, commissionCollector] = (await ethers.getSigners()) as SignerWithAddress;

        teeSigner = ethers.Wallet.createRandom();
        federationSigner = ethers.Wallet.createRandom();

        const BridgeContract = await ethers.getContractFactory('Bridge');
        const TestTokenContract = await ethers.getContractFactory('TestToken');
        const TestTokenContract2 = await ethers.getContractFactory('TestToken');

        const bridgeContractImplementation = (await BridgeContract.deploy()) as Bridge;
        await bridgeContractImplementation.waitForDeployment();
        tokenContract = (await TestTokenContract.deploy(initialSupply)) as TestToken;
        await tokenContract.waitForDeployment();
        tokenContract2 = (await TestTokenContract2.deploy(initialSupply)) as TestToken;
        await tokenContract2.waitForDeployment();

        await tokenContract.transfer(await user1.getAddress(), amountToTransfer);

        const BridgeContractProxyAdmin = await ethers.getContractFactory(
            'BridgeContractProxyAdmin'
        );
        const TransparentProxy = await ethers.getContractFactory('TransparentProxy');
        const MockContractV1 = await ethers.getContractFactory('MockContractV1');
        const mockContractV1 = (await MockContractV1.deploy()) as MockContractV1;
        await mockContractV1.waitForDeployment();
        const bridgeContractProxyAdmin =
            (await BridgeContractProxyAdmin.deploy()) as BridgeContractProxyAdmin;
        await bridgeContractProxyAdmin.waitForDeployment();
        const transparentProxy = (await TransparentProxy.deploy(
            await mockContractV1.getAddress()
        )) as TransparentProxy;
        await transparentProxy.waitForDeployment();

        await transparentProxy.changeAdmin(await bridgeContractProxyAdmin.getAddress());
        const upgradeTx = await bridgeContractProxyAdmin.upgrade(
            await transparentProxy.getAddress(),
            await bridgeContractImplementation.getAddress()
        );
        await upgradeTx.wait(1);

        bridgeContract = await ethers.getContractAt('Bridge', await transparentProxy.getAddress());
        await bridgeContract.initialize(ethers.ZeroAddress);

        chainId = await bridgeContract.getChainId();

        // Set commissionCollector BEFORE transferring ownership
        await bridgeContract.setCommissionCollector(await commissionCollector.getAddress());

        // Deploy MultisigProxy
        const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
        multisigProxy = (await MultisigFactory.deploy(
            await bridgeContract.getAddress(),
            [teeSigner.address],
            1,
            [federationSigner.address],
            1,
            await owner.getAddress(), // commission recipient
            3600 // timelock duration
        )) as MultisigProxy;
        await multisigProxy.waitForDeployment();

        // Transfer Bridge ownership to MultisigProxy
        await bridgeContract.transferOwnership(await multisigProxy.getAddress());

        const multisigAddress = await multisigProxy.getAddress();
        domain = {
            name: 'MultisigProxy',
            version: '1',
            chainId,
            verifyingContract: multisigAddress,
        };
    });

    it('user can not cheat bridgeIn', async () => {
        async function getSignatureBridgeIn(
            _tokenContract = tokenContract,
            _amountToTransfer = amountToTransfer,
            commission = testCommission,
            _destinationChain = destinationChain,
            _destinationAddress = destinationAddress,
            deadline: number,
            nonce: number,
            transactionId = bridgeInTransactionId
        ) {
            return signFundsIn(teeSigner, domain, {
                sender: await user1.getAddress(),
                token: await _tokenContract.getAddress(),
                amount: _amountToTransfer,
                commission,
                destinationChain: _destinationChain,
                destinationAddress: _destinationAddress,
                deadline,
                nonce,
                transactionId,
            });
        }

        async function bridgeIn(
            _commission = testCommission,
            _destinationChain = destinationChain,
            _destinationAddress = destinationAddress,
            deadline: number,
            nonce: number,
            _bridgeInTransactionId = bridgeInTransactionId,
            signatureBridgeIn: string | Uint8Array
        ) {
            let tokenContractAddress = await tokenContract.getAddress();

            return await bridgeContract.connect(user1).fundsIn(
                {
                    token: tokenContractAddress,
                    amount: amountToTransfer,
                    commission: _commission,
                    destinationChain: _destinationChain,
                    destinationAddress: _destinationAddress,
                    deadline,
                    nonce,
                    transactionId: _bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            );
        }

        const deadline = (await getCurrentTimeFromNetwork()) + 1000;

        // should revert if deadline is incorrect
        let signatureBridgeIn = await getSignatureBridgeIn(
            tokenContract,
            amountToTransfer,
            testCommission,
            'Solana',
            destinationAddress,
            deadline - 2000,
            0,
            bridgeInTransactionId
        );
        await expect(
            bridgeIn(
                testCommission,
                'Solana',
                destinationAddress,
                deadline - 2000,
                0,
                bridgeInTransactionId,
                signatureBridgeIn
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'ExpiredSignature');

        // should revert if nonce already used
        signatureBridgeIn = await getSignatureBridgeIn(
            tokenContract,
            amountToTransfer,
            testCommission,
            'Solana',
            destinationAddress,
            deadline,
            1,
            bridgeInTransactionId
        );
        await tokenContract
            .connect(user1)
            .approve(await bridgeContract.getAddress(), amountToTransfer);

        await bridgeIn(
            testCommission,
            'Solana',
            destinationAddress,
            deadline,
            1,
            bridgeInTransactionId,
            signatureBridgeIn
        );

        // it should revert if signature already used
        await expect(
            bridgeIn(
                testCommission,
                'Solana',
                destinationAddress,
                deadline,
                1,
                bridgeInTransactionId,
                signatureBridgeIn
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'AlreadyUsedSignature');

        // it should revert if commission greater than amount
        signatureBridgeIn = await getSignatureBridgeIn(
            tokenContract,
            amountToTransfer,
            testCommission,
            'Solana',
            destinationAddress,
            deadline,
            3,
            bridgeInTransactionId
        );
        await expect(
            bridgeIn(
                testCommission + amountToTransfer,
                'Solana',
                destinationAddress,
                deadline,
                3,
                bridgeInTransactionId,
                signatureBridgeIn
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'CommissionGreaterThanAmount');

        // it should revert if destination chain is invalid
        signatureBridgeIn = await getSignatureBridgeIn(
            tokenContract,
            amountToTransfer,
            testCommission,
            '',
            destinationAddress,
            deadline,
            4,
            bridgeInTransactionId
        );
        await expect(
            bridgeIn(
                testCommission,
                '',
                destinationAddress,
                deadline,
                4,
                bridgeInTransactionId,
                signatureBridgeIn
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidDestinationChain');

        // it should revert if destination address is invalid
        signatureBridgeIn = await getSignatureBridgeIn(
            tokenContract,
            amountToTransfer,
            testCommission,
            'Solana',
            '',
            deadline,
            4,
            bridgeInTransactionId
        );
        await expect(
            bridgeIn(
                testCommission,
                'Solana',
                '',
                deadline,
                4,
                bridgeInTransactionId,
                signatureBridgeIn
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidDestinationAddress');
    });

    it('user can not cheat bridgeInNative', async () => {
        async function getSignatureBridgeInNative(
            commission = testCommission,
            _destinationChain = destinationChain,
            _destinationAddress = destinationAddress,
            deadline: number,
            nonce: number,
            transactionId = bridgeInTransactionId
        ) {
            return signFundsInNative(teeSigner, domain, {
                sender: await user1.getAddress(),
                commission,
                destinationChain: _destinationChain,
                destinationAddress: _destinationAddress,
                deadline,
                nonce,
                transactionId,
            });
        }

        async function bridgeInNative(
            _commission = testCommission,
            _destinationChain = destinationChain,
            _destinationAddress = destinationAddress,
            deadline: number,
            nonce: number,
            _bridgeInTransactionId = bridgeInTransactionId,
            signatureBridgeInNative: string | Uint8Array
        ) {
            return await bridgeContract.connect(user1).fundsInNative(
                {
                    commission: _commission,
                    destinationChain: _destinationChain,
                    destinationAddress: _destinationAddress,
                    deadline,
                    nonce,
                    transactionId: _bridgeInTransactionId,
                },
                signatureBridgeInNative,
                0,
                { value: amountToTransfer }
            );
        }

        const deadline = (await getCurrentTimeFromNetwork()) + 1000;

        // should revert if deadline is incorrect
        let signatureBridgeInNative = await getSignatureBridgeInNative(
            testCommission,
            'Solana',
            destinationAddress,
            deadline - 2000,
            0,
            bridgeInTransactionId
        );
        await expect(
            bridgeInNative(
                testCommission,
                'Solana',
                destinationAddress,
                deadline - 2000,
                0,
                bridgeInTransactionId,
                signatureBridgeInNative
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'ExpiredSignature');

        // should revert if nonce already used
        signatureBridgeInNative = await getSignatureBridgeInNative(
            testCommission,
            'Solana',
            destinationAddress,
            deadline,
            1,
            bridgeInTransactionId
        );
        bridgeInNative(
            testCommission,
            'Solana',
            destinationAddress,
            deadline,
            1,
            bridgeInTransactionId,
            signatureBridgeInNative
        );

        // it should revert if signature already used
        await expect(
            bridgeInNative(
                testCommission,
                'Solana',
                destinationAddress,
                deadline,
                1,
                bridgeInTransactionId,
                signatureBridgeInNative
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'AlreadyUsedSignature');

        // it should revert if commission greater than amount
        signatureBridgeInNative = await getSignatureBridgeInNative(
            testCommission,
            'Solana',
            destinationAddress,
            deadline,
            3,
            bridgeInTransactionId
        );
        await expect(
            bridgeInNative(
                testCommission + amountToTransfer,
                'Solana',
                destinationAddress,
                deadline,
                3,
                bridgeInTransactionId,
                signatureBridgeInNative
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'CommissionGreaterThanAmount');

        // it should revert if destination chain is invalid
        signatureBridgeInNative = await getSignatureBridgeInNative(
            testCommission,
            '',
            destinationAddress,
            deadline,
            4,
            bridgeInTransactionId
        );
        await expect(
            bridgeInNative(
                testCommission,
                '',
                destinationAddress,
                deadline,
                4,
                bridgeInTransactionId,
                signatureBridgeInNative
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidDestinationChain');

        // it should revert if destination address is invalid
        signatureBridgeInNative = await getSignatureBridgeInNative(
            testCommission,
            'Solana',
            '',
            deadline,
            4,
            bridgeInTransactionId
        );
        await expect(
            bridgeInNative(
                testCommission,
                'Solana',
                '',
                deadline,
                4,
                bridgeInTransactionId,
                signatureBridgeInNative
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidDestinationAddress');
    });

    it('owner can not withdraw incorrect amount of native tokens', async () => {
        const callData = bridgeContract.interface.encodeFunctionData('fundsOutNative', [
            await user1.getAddress(),
            amountToTransfer,
            ethers.parseEther('50'),
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);
        await expect(executeOnBridge(callData)).to.be.revertedWithCustomError(bridgeContract, 'AmountExceedBridgePool');
    });

    it('should revert if recipient is 0 address', async () => {
        const callDataNative = bridgeContract.interface.encodeFunctionData('fundsOutNative', [
            emptyAddress,
            amountToTransfer,
            ethers.parseEther('50'),
            bridgeOutTransactionId,
            'anySourceChain',
            'anySourceAddress',
        ]);
        await expect(executeOnBridge(callDataNative)).to.be.revertedWithCustomError(bridgeContract, 'InvalidRecipientAddress');

        const callDataToken = bridgeContract.interface.encodeFunctionData('fundsOut', [
            await tokenContract.getAddress(),
            emptyAddress,
            amountToTransfer,
            ethers.parseEther('50'),
            bridgeOutTransactionId,
            destinationChain,
            destinationAddress,
        ]);
        await expect(executeOnBridge(callDataToken)).to.be.revertedWithCustomError(bridgeContract, 'InvalidRecipientAddress');
    });

    it('should be deployed with correct values', async () => {
        expect(await tokenContract.balanceOf(await user1.getAddress())).to.equal(amountToTransfer);
    });

    it('should not set invalid circle contract', async () => {
        // setCircleContract is onlyOwner (MultisigProxy); route through execute()
        // But setCircleContract is not in the TEE allowlist, so any direct call to Bridge reverts
        // with onlyOwner. Test that an arbitrary user is rejected.
        await expect(
            bridgeContract
                .connect(user1)
                .setCircleContract('0x0000000000000000000000000000000000000000')
        ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('arbitrary user can not set contract address', async () => {
        await expect(
            bridgeContract
                .connect(user1)
                .setCircleContract('0x7e0f5A592322Bc973DDE62dF3f91604D21d37446')
        ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should not set invalid commission collector address', async () => {
        // setCommissionCollector is onlyOwner (MultisigProxy); any direct call reverts
        await expect(
            bridgeContract
                .connect(user1)
                .setCommissionCollector('0x0000000000000000000000000000000000000000')
        ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('arbitrary user can not bridge tokens out', async () => {
        await expect(
            bridgeContract.connect(user1).fundsOut(
                await tokenContract.getAddress(),
                await user1.getAddress(),
                amountToTransfer,
                ethers.parseEther('50'), // commission
                bridgeOutTransactionId,
                destinationChain,
                destinationAddress
            )
        ).to.be.revertedWith('Ownable: caller is not the owner');

        await expect(
            bridgeContract.connect(user1).fundsOutMint(
                await tokenContract.getAddress(),
                await user1.getAddress(),
                amountToTransfer,
                ethers.parseEther('50'), // commission
                bridgeOutTransactionId,
                destinationChain,
                destinationAddress
            )
        ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('arbitrary user can provide wrong addresses to bridge tokens out', async () => {
        // fundsOut/fundsOutMint are onlyOwner; validation of bad args is tested via executeOnBridge
        const fundsOutBadToken = bridgeContract.interface.encodeFunctionData('fundsOut', [
            emptyAddress,
            await user1.getAddress(),
            amountToTransfer,
            ethers.parseEther('50'),
            bridgeOutTransactionId,
            destinationChain,
            destinationAddress,
        ]);
        await expect(executeOnBridge(fundsOutBadToken)).to.be.revertedWithCustomError(bridgeContract, 'InvalidTokenAddress');

        const fundsOutMintBadToken = bridgeContract.interface.encodeFunctionData('fundsOutMint', [
            emptyAddress,
            await user1.getAddress(),
            amountToTransfer,
            ethers.parseEther('50'),
            bridgeOutTransactionId,
            destinationChain,
            destinationAddress,
        ]);
        await expect(executeOnBridge(fundsOutMintBadToken)).to.be.revertedWithCustomError(bridgeContract, 'InvalidTokenAddress');

        const fundsOutMintBadRecipient = bridgeContract.interface.encodeFunctionData('fundsOutMint', [
            await tokenContract.getAddress(),
            emptyAddress,
            amountToTransfer,
            ethers.parseEther('50'),
            bridgeOutTransactionId,
            destinationChain,
            destinationAddress,
        ]);
        await expect(executeOnBridge(fundsOutMintBadRecipient)).to.be.revertedWithCustomError(bridgeContract, 'InvalidRecipientAddress');
    });

    it('Commission collector can not withdraw more tokens than available in commission pool', async () => {
        const commissionInPool = await bridgeContract.getCommissionPoolAmount(
            await tokenContract.getAddress()
        );
        await expect(
            bridgeContract
                .connect(commissionCollector)
                .withdrawCommission(
                    await tokenContract.getAddress(),
                    commissionInPool + 1n,
                    await commissionCollector.getAddress()
                )
        ).to.be.revertedWithCustomError(bridgeContract, 'AmountExceedCommissionPool');
    });

    it('arbitrary user can not set commission collector address', async () => {
        await expect(
            bridgeContract
                .connect(user1)
                .setCommissionCollector('0x7e0f5A592322Bc973DDE62dF3f91604D21d37446')
        ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('arbitrary user can not withdraw commission', async () => {
        const [totalCommission] = getAmountToReturnAndTotalCommission();
        await expect(
            bridgeContract
                .connect(owner)
                .withdrawCommission(
                    await tokenContract.getAddress(),
                    totalCommission,
                    await owner.getAddress()
                )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidCommissionCollectorAddress');
    });

    it('should revert if caller not a signer (renounceOwnership blocked)', async () => {
        // renounceOwnership is onlyOwner; owner is now MultisigProxy, so direct call reverts
        await expect(bridgeContract.connect(owner).renounceOwnership()).to.be.revertedWith(
            'Ownable: caller is not the owner'
        );
    });

    it('user can not cheat bridgeIn', async () => {
        let deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const nonce = 5;
        const signatureBridgeIn = await signFundsIn(teeSigner, domain, {
            sender: await user1.getAddress(),
            token: await tokenContract.getAddress(),
            amount: amountToTransfer,
            commission: testCommission,
            destinationChain,
            destinationAddress,
            deadline,
            nonce,
            transactionId: bridgeInTransactionId,
        });

        // early validation failures — no valid sig needed
        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: emptyAddress,
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline: 1000,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                '0x',
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidTokenAddress');

        await expect(
            bridgeContract.connect(user1).fundsInBurn(
                {
                    token: emptyAddress,
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline: 1000,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                '0x',
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidTokenAddress');

        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress: emptyDestinationAddress,
                    deadline: 1000,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                '0x',
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidDestinationAddress');

        await expect(
            bridgeContract.connect(user1).fundsInBurn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress: emptyDestinationAddress,
                    deadline: 1000,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                '0x',
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidDestinationAddress');

        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain: emptyDestinationChain,
                    destinationAddress,
                    deadline: 1000,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                '0x',
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidDestinationChain');

        await expect(
            bridgeContract.connect(user1).fundsInBurn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain: emptyDestinationChain,
                    destinationAddress,
                    deadline: 1000,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                '0x',
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidDestinationChain');

        // signature mismatch tests — params differ from what was signed
        const incorrectNonce = 1;
        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce: incorrectNonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        await expect(
            bridgeContract.connect(user1).fundsInBurn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce: incorrectNonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        const incorrectContract = await tokenContract2.getAddress();
        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: incorrectContract,
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        await expect(
            bridgeContract.connect(user1).fundsInBurn(
                {
                    token: incorrectContract,
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        const incorrectSum = amountToTransfer + 10000n;
        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: await tokenContract.getAddress(),
                    amount: incorrectSum,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        await expect(
            bridgeContract.connect(user1).fundsInBurn(
                {
                    token: await tokenContract.getAddress(),
                    amount: incorrectSum,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        const incorrectCommission = testCommission - 5n;
        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: incorrectCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        await expect(
            bridgeContract.connect(user1).fundsInBurn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: incorrectCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        const incorrectNetwork = 'Near';
        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain: incorrectNetwork,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        await expect(
            bridgeContract.connect(user1).fundsInBurn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain: incorrectNetwork,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        const incorrectDestinationAddress = 'Near';
        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress: incorrectDestinationAddress,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        await expect(
            bridgeContract.connect(user1).fundsInBurn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress: incorrectDestinationAddress,
                    deadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        const incorrectDeadline = deadline + 100;
        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline: incorrectDeadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        await expect(
            bridgeContract.connect(user1).fundsInBurn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline: incorrectDeadline,
                    nonce,
                    transactionId: bridgeInTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        const incorrectTransactionId = 555;
        await expect(
            bridgeContract.connect(user1).fundsIn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId: incorrectTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');

        await expect(
            bridgeContract.connect(user1).fundsInBurn(
                {
                    token: await tokenContract.getAddress(),
                    amount: amountToTransfer,
                    commission: testCommission,
                    destinationChain,
                    destinationAddress,
                    deadline,
                    nonce,
                    transactionId: incorrectTransactionId,
                },
                signatureBridgeIn,
                0
            )
        ).to.be.revertedWithCustomError(bridgeContract, 'InvalidSignature');
    });

    it('should revert if amount > nativeCommission in withdrawNativeCommission', async () => {
        const nativeCommissionAmount = ethers.parseEther('10000');

        await expect(
            bridgeContract
                .connect(commissionCollector)
                .withdrawNativeCommission(nativeCommissionAmount, await commissionCollector.getAddress())
        ).to.be.revertedWithCustomError(bridgeContract, 'AmountExceedCommissionPool');
    });

    it('should unpause the contract', async () => {
        // pause via MultisigProxy.emergencyPause() — instant federation operation, no timelock
        const pauseNonce = await multisigProxy.proposalNonce();
        const pauseDeadline = (await getCurrentTimeFromNetwork()) + 3600;
        const { bitmap: pauseBitmap, signatures: pauseSigs } = await buildBitmapAndSignatures(
            [federationSigner],
            [0],
            domain,
            EmergencyPauseTypes,
            { nonce: pauseNonce, deadline: pauseDeadline }
        );
        await multisigProxy.emergencyPause(pauseNonce, pauseDeadline, pauseBitmap, pauseSigs);

        expect(await bridgeContract.paused()).to.equal(true);

        // unpause via MultisigProxy.emergencyUnpause()
        const unpauseNonce = await multisigProxy.proposalNonce();
        const unpauseDeadline = (await getCurrentTimeFromNetwork()) + 3600;
        const { bitmap: unpauseBitmap, signatures: unpauseSigs } = await buildBitmapAndSignatures(
            [federationSigner],
            [0],
            domain,
            EmergencyUnpauseTypes,
            { nonce: unpauseNonce, deadline: unpauseDeadline }
        );
        await multisigProxy.emergencyUnpause(unpauseNonce, unpauseDeadline, unpauseBitmap, unpauseSigs);

        expect(await bridgeContract.paused()).to.equal(false);
    });
});
