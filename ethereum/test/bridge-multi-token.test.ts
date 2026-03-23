import { ethers } from 'hardhat';
import { expect } from 'chai';
import { Wallet } from 'ethers';
import {
    Bridge,
    MultiToken,
    MockContractV1,
    BridgeContractProxyAdmin,
    TransparentProxy,
} from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { getCurrentTimeFromNetwork, signMessage } from './util';

describe('Bridge MultiToken test', function () {
    // Declare contract instances and signers
    let bridgeContract: Bridge;
    let multiToken: MultiToken;
    let user1: SignerWithAddress;
    let commissionCollector: SignerWithAddress;
    let chainId: bigint;

    const systemWallet = new Wallet(
        '855d9081c7cc3d234fe5f333156ba6efa612be8e0befb14338bacd13a8a90300'
    );
    const testERC1155URL = 'https://6253c1c1e0dd4950a6ec51e3b103d00c.api.mockbin.io';
    const bridgeInTransactionId = 111;
    const bridgeOutTransactionId = 1011;
    const amountToTransfer = ethers.parseEther('1000');
    const testGasCommission = ethers.parseEther('100');
    const destinationChain = 'Solana';
    const destinationAddress = '4zXwdbUDWo1S5AP2CEfv4zAPRds5PQUG1dyqLLvib2xu';
    const TYPES_FOR_SIGNATURE_BRIDGE_IN_ERC1155 = [
        'address',
        'address',
        'address',
        'uint256',
        'uint256',
        'uint256',
        'string',
        'string',
        'uint256',
        'uint256',
        'uint256',
        'uint256',
    ];

    // Helper function to bridge ERC1155 tokens
    const bridgeInERC1155Tokens = async (
        nonce: number,
        tokenId: number,
        deadline: number,
        _destinationChain = destinationChain,
        _destinationAddress = destinationAddress,
        tokenAddress: string | Promise<string> = multiToken.getAddress(),
        gasCommission = testGasCommission
    ) => {
        const signatureBridgeIn = await signMessage(
            TYPES_FOR_SIGNATURE_BRIDGE_IN_ERC1155,
            [
                await user1.getAddress(),
                await bridgeContract.getAddress(),
                await tokenAddress,
                tokenId,
                amountToTransfer,
                testGasCommission,
                _destinationChain,
                _destinationAddress,
                deadline,
                nonce,
                bridgeInTransactionId,
                chainId,
            ],
            systemWallet
        );

        // Approve the bridge contract to transfer the user's tokens
        await multiToken.connect(user1).setApprovalForAll(await bridgeContract.getAddress(), true);

        const etherCommission = ethers.parseEther('0.1');

        // Call the fundsInMultiToken function on the bridge contract to initiate the bridge-in
        return bridgeContract.connect(user1).fundsInMultiToken(
            {
                token: tokenAddress,
                tokenId: tokenId,
                amount: amountToTransfer,
                gasCommission: testGasCommission,
                destinationChain: _destinationChain,
                destinationAddress: _destinationAddress,
                deadline,
                nonce,
                transactionId: bridgeInTransactionId,
            },
            signatureBridgeIn,
            { value: etherCommission }
        );
    };

    this.beforeEach(async () => {
        // @ts-ignore
        [user1, commissionCollector] = (await ethers.getSigners()) as SignerWithAddress;
        const BridgeContract = await ethers.getContractFactory('Bridge');
        const MultiToken = await ethers.getContractFactory('MultiToken');

        const bridgeContractImplementation = (await BridgeContract.deploy()) as Bridge;

        const BridgeContractProxyAdmin = await ethers.getContractFactory(
            'BridgeContractProxyAdmin'
        );
        const TransparentProxy = await ethers.getContractFactory('TransparentProxy');
        const MockContractV1 = await ethers.getContractFactory('MockContractV1');
        const mockContractV1 = (await MockContractV1.deploy()) as MockContractV1;
        const bridgeContractProxyAdmin =
            (await BridgeContractProxyAdmin.deploy()) as BridgeContractProxyAdmin;
        const transparentProxy = (await TransparentProxy.deploy(
            await mockContractV1.getAddress()
        )) as TransparentProxy;

        // Change the proxy admin and upgrade the proxy to the actual implementation
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

        multiToken = (await MultiToken.deploy()) as MultiToken;
        await multiToken.initialize(await bridgeContract.getAddress());
    });

    describe('Bridge MultiToken negative tests', function () {
        // Helper function to mint MultiTokens for testing
        async function _tokenMint(nonce: number, tokenId: number, deadline: number) {
            const amountToMint = ethers.parseEther('2000');

            await bridgeContract.multiTokenEtch(
                await multiToken.getAddress(),
                tokenId,
                testERC1155URL
            );
            await bridgeContract.multiTokenMint(
                await user1.getAddress(),
                await multiToken.getAddress(),
                tokenId,
                amountToMint,
                bridgeOutTransactionId,
                'anySourceChain',
                'anySourceAddress'
            );
            bridgeInERC1155Tokens(1, tokenId, deadline);
        }

        it('should revert if signature is expired', async () => {
            const tokenId = 1;
            const deadline = (await getCurrentTimeFromNetwork()) - 84_000; // Set an expired deadline

            await expect(bridgeInERC1155Tokens(1113, tokenId, deadline)).to.be.revertedWith(
                'ExpiredSignature'
            );
        });

        it('should revert if param is incorrect', async () => {
            const tokenId = 1;
            const deadline = (await getCurrentTimeFromNetwork()) + 84_000;
            await _tokenMint(1113, 1, deadline);

            // Test with various incorrect parameters
            await expect(bridgeInERC1155Tokens(1, tokenId, deadline)).to.be.revertedWith(
                'AlreadyUsedSignature'
            );
            await expect(bridgeInERC1155Tokens(1113, tokenId, deadline, '')).to.be.revertedWith(
                'InvalidDestinationChain'
            );
            await expect(
                bridgeInERC1155Tokens(1113, tokenId, deadline, destinationChain, '')
            ).to.be.revertedWith('InvalidDestinationAddress');
            await expect(
                bridgeInERC1155Tokens(
                    1113,
                    tokenId,
                    deadline,
                    destinationChain,
                    destinationAddress,
                    ethers.ZeroAddress
                )
            ).to.be.revertedWith('InvalidTokenAddress');
        });
    });

    describe('Bridge MultiToken positive tests', function () {
        it('bridge multitoken should be deployed with correct values', async () => {
            expect(await multiToken.getBridgeContract()).to.equal(
                await bridgeContract.getAddress()
            );
        });

        it('should set baseURI', async () => {
            const MultiToken = await ethers.getContractFactory('MultiToken');
            multiToken = (await MultiToken.deploy()) as MultiToken;
            await multiToken.initialize(await user1.getAddress());

            await multiToken.connect(user1).mint(user1.getAddress(), 0, 1, '0x');
            await multiToken.connect(user1).setBaseURI('http://');
            await multiToken.connect(user1).setURI(1, 'test');

            expect(await multiToken.uri(1)).to.equal('http://test');
        });

        it('should allow to create new multiToken', async () => {
            const tokenId = 1;
            const amountToMint = ethers.parseEther('2000');

            await expect(
                await bridgeContract.multiTokenEtch(
                    await multiToken.getAddress(),
                    tokenId,
                    testERC1155URL
                )
            )
                .to.emit(bridgeContract, 'BridgeMultiTokenEtch')
                .withArgs(await multiToken.getAddress(), tokenId, testERC1155URL);

            await expect(
                await bridgeContract.multiTokenMint(
                    await user1.getAddress(),
                    await multiToken.getAddress(),
                    tokenId,
                    amountToMint,
                    bridgeOutTransactionId,
                    'anySourceChain',
                    'anySourceAddress'
                )
            )
                .to.emit(bridgeContract, 'BridgeMultiTokenMint')
                .withArgs(
                    await user1.getAddress(),
                    await multiToken.getAddress(),
                    tokenId,
                    amountToMint,
                    bridgeOutTransactionId,
                    'anySourceChain',
                    'anySourceAddress'
                );

            // Verify the user's balance after minting
            const balanceAfter = await multiToken.balanceOf(await user1.getAddress(), tokenId);

            expect(balanceAfter).to.equal(amountToMint);
        });

        it('should allow user to create multiToken, bridge in multiToken token and withdraw commission', async () => {
            const tokenId = 2;
            const deadline = (await getCurrentTimeFromNetwork()) + 84_000;
            const amountToMint = ethers.parseEther('2000');
            await expect(
                await bridgeContract.multiTokenEtch(
                    await multiToken.getAddress(),
                    tokenId,
                    testERC1155URL
                )
            )
                .to.emit(bridgeContract, 'BridgeMultiTokenEtch')
                .withArgs(await multiToken.getAddress(), tokenId, testERC1155URL);

            await expect(
                await bridgeContract.multiTokenMint(
                    await user1.getAddress(),
                    await multiToken.getAddress(),
                    tokenId,
                    amountToMint,
                    bridgeOutTransactionId,
                    'anySourceChain',
                    'anySourceAddress'
                )
            )
                .to.emit(bridgeContract, 'BridgeMultiTokenMint')
                .withArgs(
                    await user1.getAddress(),
                    await multiToken.getAddress(),
                    tokenId,
                    amountToMint,
                    bridgeOutTransactionId,
                    'anySourceChain',
                    'anySourceAddress'
                );

            const balanceAfterMint = await multiToken.balanceOf(await user1.getAddress(), tokenId);

            await expect(bridgeInERC1155Tokens(1113, tokenId, deadline))
                .to.emit(bridgeContract, 'BridgeMultiTokenInBurn')
                .withArgs(
                    await user1.getAddress(),
                    bridgeInTransactionId,
                    1113,
                    await multiToken.getAddress(),
                    tokenId,
                    amountToTransfer,
                    0,
                    testGasCommission,
                    destinationChain,
                    destinationAddress
                );

            const balanceAfterBridgeIn = await multiToken.balanceOf(
                await user1.getAddress(),
                tokenId
            );
            expect(balanceAfterBridgeIn).to.equal(balanceAfterMint - amountToTransfer);

            const commission1 = await bridgeContract.getNativeCommission();
            await expect(
                bridgeContract.connect(commissionCollector).withdrawNativeCommission(commission1)
            )
                .to.emit(bridgeContract, 'WithdrawNativeCommission')
                .withArgs(commission1);
            const commission2 = await bridgeContract.getNativeCommission();
            expect(commission2).to.equal(0);
        });

        it('all should allow to create and mint different multiTokens', async () => {
            const tokenId = 3;
            const amountToMint = ethers.parseEther('2000');
            const balanceBefore = await multiToken.balanceOf(await user1.getAddress(), tokenId);

            await expect(
                await bridgeContract.multiTokenEtch(
                    await multiToken.getAddress(),
                    tokenId,
                    testERC1155URL
                )
            )
                .to.emit(bridgeContract, 'BridgeMultiTokenEtch')
                .withArgs(await multiToken.getAddress(), tokenId, testERC1155URL);

            await expect(
                await bridgeContract.multiTokenMint(
                    await user1.getAddress(),
                    await multiToken.getAddress(),
                    tokenId,
                    amountToMint,
                    bridgeOutTransactionId,
                    'anySourceChain',
                    'anySourceAddress'
                )
            )
                .to.emit(bridgeContract, 'BridgeMultiTokenMint')
                .withArgs(
                    await user1.getAddress(),
                    await multiToken.getAddress(),
                    tokenId,
                    amountToMint,
                    bridgeOutTransactionId,
                    'anySourceChain',
                    'anySourceAddress'
                );

            const balanceAfter = await multiToken.balanceOf(await user1.getAddress(), tokenId);

            expect(balanceAfter).to.equal(balanceBefore + amountToMint);

            await expect(
                await bridgeContract.multiTokenMint(
                    await user1.getAddress(),
                    await multiToken.getAddress(),
                    tokenId,
                    amountToMint,
                    bridgeOutTransactionId,
                    'anySourceChain',
                    'anySourceAddress'
                )
            )
                .to.emit(bridgeContract, 'BridgeMultiTokenMint')
                .withArgs(
                    await user1.getAddress(),
                    await multiToken.getAddress(),
                    tokenId,
                    amountToMint,
                    bridgeOutTransactionId,
                    'anySourceChain',
                    'anySourceAddress'
                );

            const balanceAfterMint2 = await multiToken.balanceOf(await user1.getAddress(), tokenId);

            expect(balanceAfterMint2).to.equal(balanceAfter + amountToMint);

            const token2Id = 4;

            const balanceBeforeMintToken2 = await multiToken.balanceOf(
                await user1.getAddress(),
                token2Id
            );

            await expect(
                await bridgeContract.multiTokenEtch(
                    await multiToken.getAddress(),
                    token2Id,
                    testERC1155URL
                )
            )
                .to.emit(bridgeContract, 'BridgeMultiTokenEtch')
                .withArgs(await multiToken.getAddress(), token2Id, testERC1155URL);

            await expect(
                await bridgeContract.multiTokenMint(
                    await user1.getAddress(),
                    await multiToken.getAddress(),
                    token2Id,
                    amountToMint,
                    bridgeOutTransactionId,
                    'anySourceChain',
                    'anySourceAddress'
                )
            )
                .to.emit(bridgeContract, 'BridgeMultiTokenMint')
                .withArgs(
                    await user1.getAddress(),
                    await multiToken.getAddress(),
                    token2Id,
                    amountToMint,
                    bridgeOutTransactionId,
                    'anySourceChain',
                    'anySourceAddress'
                );

            const balanceAfter2TokenMint = await multiToken.balanceOf(
                await user1.getAddress(),
                token2Id
            );
            expect(balanceAfter2TokenMint).to.equal(balanceBeforeMintToken2 + amountToMint);
        });
    });
});
