import { ethers } from 'hardhat';
import { expect } from 'chai';
import { MultiToken } from '../typechain-types';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';

describe('MultiToken contract', function () {
    let multiToken: MultiToken;
    let owner: SignerWithAddress;
    let user1: SignerWithAddress;
    let user2: SignerWithAddress;
    const dataValue = ethers.keccak256(ethers.toUtf8Bytes(''));
    const testERC1155URL = 'https://6253c1c1e0dd4950a6ec51e3b103d00c.api.mockbin.io';

    this.beforeEach(async () => {
        // @ts-ignore
        [owner, user1, user2] = (await ethers.getSigners()) as SignerWithAddress;
        const MultiToken = await ethers.getContractFactory('MultiToken');

        multiToken = (await MultiToken.deploy()) as MultiToken;
        await multiToken.initialize(owner.address);
    });

    it('multitoken should be deployed with correct values', async () => {
        expect(await multiToken.getBridgeContract()).to.equal(owner.address);
    });

    it('should mint multitokens', async () => {
        const TOKEN_ID = 1;
        const MINT_AMOUNT = 10;

        await multiToken.mint(user1.address, TOKEN_ID, MINT_AMOUNT, dataValue);

        const balance = await multiToken.balanceOf(user1.address, TOKEN_ID);
        expect(balance).to.equal(MINT_AMOUNT);
    });

    it('should not mint multitokens from unauthorized address', async () => {
        const TOKEN_ID = 1;
        const MINT_AMOUNT = 10;

        await expect(
            multiToken.connect(user1).mint(owner.address, TOKEN_ID, MINT_AMOUNT, dataValue)
        ).to.be.revertedWith('Caller is not authorized');
    });

    it('should return true if support interface', async () => {
        const ERC1155_INTERFACE_ID = '0xd9b67a26';
        expect(await multiToken.supportsInterface(ERC1155_INTERFACE_ID)).to.equal(true);
    });

    it('should transfer multitokens', async () => {
        const TOKEN_ID = 1;
        const MINT_AMOUNT = 10;

        await multiToken.mint(user1.address, TOKEN_ID, MINT_AMOUNT, dataValue);

        const balanceAfterMint = await multiToken.balanceOf(user1.address, TOKEN_ID);
        expect(balanceAfterMint).to.equal(MINT_AMOUNT);

        await multiToken
            .connect(user1)
            .safeTransferFrom(user1.address, user2.address, 1, 10, dataValue);

        // Check balances after the transfer
        const balanceUser1 = await multiToken.balanceOf(user1.address, TOKEN_ID);
        const balanceUser2 = await multiToken.balanceOf(user2.address, TOKEN_ID);
        expect(balanceUser1).to.equal(0);
        expect(balanceUser2).to.equal(MINT_AMOUNT);
    });

    it('should not transfer multitokens from unauthorized address', async () => {
        const TOKEN_ID = 1;
        const MINT_AMOUNT = 10;

        await multiToken.mint(user1.address, TOKEN_ID, MINT_AMOUNT, dataValue);

        const balanceAfterMint = await multiToken.balanceOf(user1.address, TOKEN_ID);
        expect(balanceAfterMint).to.equal(MINT_AMOUNT);

        await expect(
            multiToken
                .connect(user2)
                .safeTransferFrom(user1.address, user2.address, TOKEN_ID, MINT_AMOUNT, dataValue)
        ).to.be.revertedWith('ERC1155: caller is not token owner or approved');
    });

    it('should burn multitokens', async () => {
        const TOKEN_ID = 1;
        const MINT_AMOUNT = 10;

        await multiToken.mint(user1.address, TOKEN_ID, MINT_AMOUNT, dataValue);

        const balance = await multiToken.balanceOf(user1.address, TOKEN_ID);
        expect(balance).to.equal(MINT_AMOUNT);

        await multiToken.burn(user1.address, TOKEN_ID, MINT_AMOUNT);

        const balanceAfterBurn = await multiToken.balanceOf(user1.address, TOKEN_ID);
        expect(balanceAfterBurn).to.equal(0);
    });

    it('should not burn multitokens from unauthorized address', async () => {
        const TOKEN_ID = 1;
        const MINT_AMOUNT = 10;

        await multiToken.mint(user1.address, TOKEN_ID, MINT_AMOUNT, dataValue);

        const balance = await multiToken.balanceOf(user1.address, TOKEN_ID);
        expect(balance).to.equal(MINT_AMOUNT);

        // Try to burn tokens as user1 (unauthorized) and expect a revert
        await expect(
            multiToken.connect(user1).burn(user1.address, TOKEN_ID, MINT_AMOUNT)
        ).to.be.revertedWith('Caller is not authorized');
    });

    it('should set URI for multitoken', async () => {
        const TOKEN_ID = 1;

        await multiToken.setURI(TOKEN_ID, testERC1155URL);

        const uri = await multiToken.uri(TOKEN_ID);
        expect(uri).to.equal(testERC1155URL);
    });

    it('should set new bridge address', async () => {
        const randomBridgeAddress = ethers.Wallet.createRandom().address;

        await multiToken.setBridgeContract(randomBridgeAddress);

        expect(await multiToken.getBridgeContract()).to.equal(randomBridgeAddress);
    });

    it('should not set URI for multitoken from unauthorized address', async () => {
        const TOKEN_ID = 1;

        await expect(multiToken.connect(user1).setURI(TOKEN_ID, testERC1155URL)).to.be.revertedWith(
            'Caller is not authorized'
        );
    });

    it('should approve multitokens', async () => {
        const TOKEN_ID = 1;
        const MINT_AMOUNT = 10;

        await multiToken.mint(user1.address, TOKEN_ID, MINT_AMOUNT, dataValue);

        const balance = await multiToken.balanceOf(user1.address, TOKEN_ID);
        expect(balance).to.equal(MINT_AMOUNT);

        // Check initial approval status
        const isApprovedBefore = await multiToken.isApprovedForAll(user1.address, user2.address);
        expect(isApprovedBefore).to.equal(false);

        await multiToken.connect(user1).setApprovalForAll(user2.address, true);

        // Verify approval
        const isApprovedAfter = await multiToken.isApprovedForAll(user1.address, user2.address);
        expect(isApprovedAfter).to.equal(true);

        const balanceUser1BeforeTransfer = await multiToken.balanceOf(user1.address, TOKEN_ID);
        const balanceOwnerBeforeTransfer = await multiToken.balanceOf(owner.address, TOKEN_ID);
        expect(balanceUser1BeforeTransfer).to.equal(MINT_AMOUNT);
        expect(balanceOwnerBeforeTransfer).to.equal(0);

        await multiToken
            .connect(user2)
            .safeTransferFrom(user1.address, owner.address, 1, 10, dataValue);

        const balanceUser1AfterTransfer = await multiToken.balanceOf(user1.address, TOKEN_ID);
        const balanceOwnerAfterTransfer = await multiToken.balanceOf(owner.address, TOKEN_ID);
        expect(balanceUser1AfterTransfer).to.equal(0);
        expect(balanceOwnerAfterTransfer).to.equal(MINT_AMOUNT);
    });

    it('should revoke multitokens approval', async () => {
        const TOKEN_ID = 1;
        const MINT_AMOUNT = 10;

        await multiToken.mint(user1.address, TOKEN_ID, MINT_AMOUNT, dataValue);

        const balance = await multiToken.balanceOf(user1.address, TOKEN_ID);
        expect(balance).to.equal(MINT_AMOUNT);

        const isApprovedBefore = await multiToken.isApprovedForAll(user1.address, user2.address);
        expect(isApprovedBefore).to.equal(false);

        await multiToken.connect(user1).setApprovalForAll(user2.address, true);

        const isApprovedAfter = await multiToken.isApprovedForAll(user1.address, user2.address);
        expect(isApprovedAfter).to.equal(true);

        await multiToken.connect(user1).setApprovalForAll(user2.address, false);

        const approvalAfterRevoke = await multiToken.isApprovedForAll(user1.address, user2.address);
        expect(approvalAfterRevoke).to.equal(false);
    });

    it('should transfer batch multitokens', async () => {
        const MINT_AMOUNT = 10;
        const TRANSFER_AMOUNT = 5;

        await multiToken.mint(user1.address, 1, MINT_AMOUNT, dataValue);

        await multiToken.mint(user1.address, 2, MINT_AMOUNT, dataValue);

        await multiToken.mint(user1.address, 3, MINT_AMOUNT, dataValue);

        const balance1AfterMint = await multiToken.balanceOf(user1.address, 1);
        const balance2AfterMint = await multiToken.balanceOf(user1.address, 2);
        const balance3AfterMint = await multiToken.balanceOf(user1.address, 3);
        expect(balance1AfterMint).to.equal(MINT_AMOUNT);
        expect(balance2AfterMint).to.equal(MINT_AMOUNT);
        expect(balance3AfterMint).to.equal(MINT_AMOUNT);

        await multiToken
            .connect(user1)
            .safeBatchTransferFrom(
                user1.address,
                user2.address,
                [1, 2, 3],
                [TRANSFER_AMOUNT, TRANSFER_AMOUNT, TRANSFER_AMOUNT],
                dataValue
            );

        const balanceUser1Token1 = await multiToken.balanceOf(user1.address, 1);
        const balanceUser1Token2 = await multiToken.balanceOf(user1.address, 2);
        const balanceUser1Token3 = await multiToken.balanceOf(user1.address, 3);
        const balanceUser2Token1 = await multiToken.balanceOf(user2.address, 1);
        const balanceUser2Token2 = await multiToken.balanceOf(user2.address, 2);
        const balanceUser2Token3 = await multiToken.balanceOf(user2.address, 3);
        expect(balanceUser1Token1).to.equal(TRANSFER_AMOUNT);
        expect(balanceUser1Token2).to.equal(TRANSFER_AMOUNT);
        expect(balanceUser1Token3).to.equal(TRANSFER_AMOUNT);
        expect(balanceUser2Token1).to.equal(TRANSFER_AMOUNT);
        expect(balanceUser2Token2).to.equal(TRANSFER_AMOUNT);
        expect(balanceUser2Token3).to.equal(TRANSFER_AMOUNT);
    });

    it('should not transfer batch multitokens with insufficient balance', async () => {
        const MINT_AMOUNT = 10;
        const TRANSFER_AMOUNT = 5;

        await multiToken.mint(user1.address, 1, MINT_AMOUNT, dataValue);

        await multiToken.mint(user1.address, 2, MINT_AMOUNT, dataValue);

        await multiToken.mint(user1.address, 3, MINT_AMOUNT, dataValue);

        const balance1AfterMint = await multiToken.balanceOf(user1.address, 1);
        const balance2AfterMint = await multiToken.balanceOf(user1.address, 2);
        const balance3AfterMint = await multiToken.balanceOf(user1.address, 3);
        expect(balance1AfterMint).to.equal(MINT_AMOUNT);
        expect(balance2AfterMint).to.equal(MINT_AMOUNT);
        expect(balance3AfterMint).to.equal(MINT_AMOUNT);

        await expect(
            multiToken
                .connect(user1)
                .safeBatchTransferFrom(
                    user1.address,
                    user2.address,
                    [1, 2, 3],
                    [TRANSFER_AMOUNT, TRANSFER_AMOUNT, TRANSFER_AMOUNT + 10],
                    dataValue
                )
        ).to.be.revertedWith('ERC1155: insufficient balance for transfer');
    });

    it('should mint batch multitokens', async () => {
        const TOKEN_IDS = [1, 2, 3];
        const MINT_AMOUNTS = [10, 20, 30];

        await multiToken.mintBatch(user1.address, TOKEN_IDS, MINT_AMOUNTS, dataValue);

        const balance1 = await multiToken.balanceOf(user1.address, TOKEN_IDS[0]);
        const balance2 = await multiToken.balanceOf(user1.address, TOKEN_IDS[1]);
        const balance3 = await multiToken.balanceOf(user1.address, TOKEN_IDS[2]);

        expect(balance1).to.equal(MINT_AMOUNTS[0]);
        expect(balance2).to.equal(MINT_AMOUNTS[1]);
        expect(balance3).to.equal(MINT_AMOUNTS[2]);
    });
});
