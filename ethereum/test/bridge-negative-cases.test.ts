import { ethers } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/src/signers';
import { Wallet } from 'ethers';
import {
    Bridge,
    TestToken,
    MultiToken,
    BridgeContractProxyAdmin,
    TransparentProxy,
    MockContractV1,
} from '../typechain-types';
import { signMessage, getCurrentTimeFromNetwork } from './util';

describe('Bridge Negative Cases test', function () {
    let bridgeContract: Bridge;
    let tokenContract: TestToken;
    let tokenContract2: TestToken;
    let multiTokenContract: MultiToken;

    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let commissionCollector: SignerWithAddress;

    let systemWallet = new Wallet(
        '855d9081c7cc3d234fe5f333156ba6efa612be8e0befb14338bacd13a8a90300'
    );
    const initialSupply = ethers.parseEther('10000');
    const amountToTransfer = ethers.parseEther('1000');
    const testCommission = ethers.parseEther('140'); // Pre-calculated commission
    const destinationChain = 'Solana';
    const destinationAddress = '4zXwdbUDWo1S5AP2CEfv4zAPRds5PQUG1dyqLLvib2xu';
    const TYPES_FOR_SIGNATURE_BRIDGE_IN = [
        'address',
        'address',
        'address',
        'uint256',
        'uint256',
        'string',
        'string',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
    ];
    const TYPES_FOR_SIGNATURE_BRIDGE_IN_NATIVE = [
        'address',
        'address',
        'uint256',
        'string',
        'string',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
    ];
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

    this.beforeEach(async () => {
        // @ts-ignore
        [owner, user1, commissionCollector] = (await ethers.getSigners()) as SignerWithAddress;

        const BridgeContract = await ethers.getContractFactory('Bridge');
        const TestTokenContract = await ethers.getContractFactory('TestToken');
        const TestTokenContract2 = await ethers.getContractFactory('TestToken');
        const MultiToken = await ethers.getContractFactory('MultiToken');

        const bridgeContractImplementation = (await BridgeContract.deploy()) as Bridge;
        await bridgeContractImplementation.waitForDeployment();
        tokenContract = (await TestTokenContract.deploy(initialSupply)) as TestToken;
        await tokenContract.waitForDeployment();
        tokenContract2 = (await TestTokenContract2.deploy(initialSupply)) as TestToken;
        await tokenContract2.waitForDeployment();

        multiTokenContract = (await MultiToken.deploy()) as MultiToken;
        await multiTokenContract.waitForDeployment();

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
        await bridgeContract.initialize(await systemWallet.getAddress());

        chainId = await bridgeContract.getChainId();
        await bridgeContract.setCommissionCollector(await commissionCollector.getAddress());

        await multiTokenContract.initialize(await bridgeContract.getAddress());
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
            const signatureBridgeIn = signMessage(
                TYPES_FOR_SIGNATURE_BRIDGE_IN,
                [
                    await user1.getAddress(),
                    await bridgeContract.getAddress(),
                    await _tokenContract.getAddress(),
                    _amountToTransfer,
                    commission,
                    _destinationChain,
                    _destinationAddress,
                    deadline,
                    nonce,
                    transactionId,
                    chainId,
                ],
                systemWallet
            );

            return signatureBridgeIn;
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
                signatureBridgeIn
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
        ).to.be.revertedWith('ExpiredSignature');

        // should revert if nonce already use
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

        // it should revert if signature already use
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
        ).to.be.revertedWith('AlreadyUsedSignature');

        // it should revert if comission greater than amount
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
        ).to.be.revertedWith('CommissionGreaterThanAmount');

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
        ).to.be.revertedWith('InvalidDestinationChain');

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
        ).to.be.revertedWith('InvalidDestinationAddress');
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
            const signatureBridgeInNative = signMessage(
                TYPES_FOR_SIGNATURE_BRIDGE_IN_NATIVE,
                [
                    await user1.getAddress(),
                    await bridgeContract.getAddress(),
                    commission,
                    _destinationChain,
                    _destinationAddress,
                    deadline,
                    nonce,
                    transactionId,
                    chainId,
                ],
                systemWallet
            );

            return signatureBridgeInNative;
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
        ).to.be.revertedWith('ExpiredSignature');

        // should revert if nonce already use
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

        // it should revert if signature already use
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
        ).to.be.revertedWith('AlreadyUsedSignature');

        // it should revert if comission greater than amount
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
        ).to.be.revertedWith('CommissionGreaterThanAmount');

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
        ).to.be.revertedWith('InvalidDestinationChain');

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
        ).to.be.revertedWith('InvalidDestinationAddress');
    });

    it('owner can not withdraw incorrect amount of native tokens', async () => {
        await expect(
            bridgeContract.connect(owner).fundsOutNative(
                await user1.getAddress(),
                amountToTransfer,
                ethers.parseEther('50'), // commission
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            )
        ).to.be.revertedWith('AmountExceedBridgePool');
    });

    it('should revert if recipient is 0 address', async () => {
        await expect(
            bridgeContract.connect(owner).fundsOutNative(
                emptyAddress,
                amountToTransfer,
                ethers.parseEther('50'), // commission
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            )
        ).to.be.revertedWith('InvalidRecipientAddress');

        await expect(
            bridgeContract.connect(owner).fundsOut(
                await tokenContract.getAddress(),
                emptyAddress,
                amountToTransfer,
                ethers.parseEther('50'), // commission
                bridgeOutTransactionId,
                destinationChain,
                destinationAddress
            )
        ).to.be.revertedWith('InvalidRecipientAddress');
    });

    it('should be deployed with correct values', async () => {
        expect(await tokenContract.balanceOf(await user1.getAddress())).to.equal(amountToTransfer);
    });

    it('should not set invalid circle contract', async () => {
        await expect(
            bridgeContract.setCircleContract('0x0000000000000000000000000000000000000000')
        ).to.be.revertedWith('InvalidCircleContractAddress');
    });

    it('arbitrary user can not set contract address', async () => {
        await expect(
            bridgeContract
                .connect(user1)
                .setCircleContract('0x7e0f5A592322Bc973DDE62dF3f91604D21d37446')
        ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should not set invalid commission collector address', async () => {
        await expect(
            bridgeContract.setCommissionCollector('0x0000000000000000000000000000000000000000')
        ).to.be.revertedWith('InvalidCommissionCollectorAddress');
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
        await expect(
            bridgeContract.fundsOut(
                emptyAddress,
                await user1.getAddress(),
                amountToTransfer,
                ethers.parseEther('50'), // commission
                bridgeOutTransactionId,
                destinationChain,
                destinationAddress
            )
        ).to.be.revertedWith('InvalidTokenAddress');
        await expect(
            bridgeContract.fundsOutMint(
                emptyAddress,
                await user1.getAddress(),
                amountToTransfer,
                ethers.parseEther('50'), // commission
                bridgeOutTransactionId,
                destinationChain,
                destinationAddress
            )
        ).to.be.revertedWith('InvalidTokenAddress');
        await expect(
            bridgeContract.fundsOutMint(
                await tokenContract.getAddress(),
                emptyAddress,
                amountToTransfer,
                ethers.parseEther('50'), // commission
                bridgeOutTransactionId,
                destinationChain,
                destinationAddress
            )
        ).to.be.revertedWith('InvalidRecipientAddress');
        await expect(
            bridgeContract.fundsOutMint(
                await tokenContract.getAddress(),
                emptyAddress,
                amountToTransfer,
                ethers.parseEther('50'), // commission
                bridgeOutTransactionId,
                destinationChain,
                destinationAddress
            )
        ).to.be.revertedWith('InvalidRecipientAddress');
    });

    it('Commission collector can not withdraw more tokens than available in commission pool', async () => {
        await bridgeContract.setCommissionCollector(await commissionCollector.getAddress());
        const commissionInPool = await bridgeContract.getCommissionPoolAmount(
            await tokenContract.getAddress()
        );
        await expect(
            bridgeContract
                .connect(commissionCollector)
                .withdrawCommission(await tokenContract.getAddress(), commissionInPool + 1n)
        ).to.be.revertedWith('AmountExceedCommissionPool');
    });

    it('arbitrary user can not set coommission collector address', async () => {
        await expect(
            bridgeContract
                .connect(user1)
                .setCommissionCollector('0x7e0f5A592322Bc973DDE62dF3f91604D21d37446')
        ).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('arbitrary user can not withdraw commission', async () => {
        const [totalCommission] = await getAmountToReturnAndTotalCommission();
        await expect(
            bridgeContract
                .connect(owner)
                .withdrawCommission(await tokenContract.getAddress(), totalCommission)
        ).to.be.revertedWith('InvalidCommissionCollectorAddress');
    });

    it('should revert if caller not a signer', async () => {
        await expect(bridgeContract.connect(owner).renounceOwnership()).to.be.revertedWith(
            'InvalidSignerAddress'
        );
    });

    it('user can not cheat bridgeIn', async () => {
        let deadline = (await getCurrentTimeFromNetwork()) + 1000;
        const nonce = 5;
        const signatureBridgeIn = await signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN,
            [
                await user1.getAddress(),
                await bridgeContract.getAddress(),
                await tokenContract.getAddress(),
                amountToTransfer,
                testCommission,
                destinationChain,
                destinationAddress,
                deadline,
                5,
                bridgeInTransactionId,
                chainId,
            ],
            systemWallet
        );

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
                '0x'
            )
        ).to.be.revertedWith('InvalidTokenAddress');

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
                '0x'
            )
        ).to.be.revertedWith('InvalidTokenAddress');

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
                '0x'
            )
        ).to.be.revertedWith('InvalidDestinationAddress');

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
                '0x'
            )
        ).to.be.revertedWith('InvalidDestinationAddress');

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
                '0x'
            )
        ).to.be.revertedWith('InvalidDestinationChain');

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
                '0x'
            )
        ).to.be.revertedWith('InvalidDestinationChain');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

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
                signatureBridgeIn
            )
        ).to.be.revertedWith('InvalidSignature');

        // bridgeContract will be invalid in this context
        // const realContract = '0x47761b7E9E203aF9853107FbC6d8D0353Cda7a0e';
        // const InvalidSignatureBridgeIn = signMessage(
        //     TYPES_FOR_SIGNATURE_BRIDGE_IN,
        //     [await user1.getAddress(), await tokenContract.getAddress(), amountToTransfer, testCommission, destinationChain, destinationAddress, deadline, 5],
        //     systemWallet
        // );

        // await expect(bridgeContract.connect(user1).bridgeIn(
        //     await tokenContract.getAddress(),
        //     amountToTransfer,
        //     testCommission,
        //     destinationChain,
        //     destinationAddress,
        //     deadline,
        //     5,
        //     InvalidSignatureBridgeIn
        // )).to.be.revertedWith('InvalidSignature');
    });

    it('should revert if amount > nativeCommission in withdrawNativeCommission', async () => {
        const nativeCommissionAmount = ethers.parseEther('10000');

        await expect(
            bridgeContract
                .connect(commissionCollector)
                .withdrawNativeCommission(nativeCommissionAmount)
        ).to.be.revertedWith('AmountExceedCommissionPool');
    });

    it('should revert if multiToken with given tokenId already exists', async () => {
        const tokenId = 1;
        const tokenURI = 'test';

        await bridgeContract
            .connect(owner)
            .multiTokenEtch(await multiTokenContract.getAddress(), tokenId, tokenURI);

        await expect(
            bridgeContract
                .connect(owner)
                .multiTokenEtch(await multiTokenContract.getAddress(), tokenId, tokenURI)
        ).to.be.revertedWith('MultiTokenAlreadyExist');
    });

    it('should revert in multiToken mint', async () => {
        // should revert if recipient address is 0
        await expect(
            bridgeContract
                .connect(owner)
                .multiTokenMint(
                    emptyAddress,
                    await multiTokenContract.getAddress(),
                    1,
                    1,
                    1,
                    destinationChain,
                    destinationAddress
                )
        ).to.be.revertedWith('InvalidRecipientAddress');

        // should revert if tokenId is incorrect
        await expect(
            bridgeContract
                .connect(owner)
                .multiTokenMint(
                    user1,
                    await multiTokenContract.getAddress(),
                    666,
                    1,
                    1,
                    destinationChain,
                    destinationAddress
                )
        ).to.be.revertedWith('MultiTokenNotExist');
    });

    it('should unpause the contract', async () => {
        await bridgeContract.connect(owner).pause();

        expect(await bridgeContract.paused()).to.equal(true);

        await bridgeContract.connect(owner).unpause();

        expect(await bridgeContract.paused()).to.equal(false);
    });
});
