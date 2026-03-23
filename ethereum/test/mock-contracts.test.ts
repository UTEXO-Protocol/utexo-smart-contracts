import { ethers } from 'hardhat';
import { expect } from 'chai';
import { MockContractV1, MockContractV2 } from '../typechain-types';

describe('MockContracts tests', function () {
    let user: any;
    let mockContractV1: MockContractV1;
    let mockContractV2: MockContractV2;

    before(async () => {
        [user] = await ethers.getSigners();

        const MockContractV1Factory = await ethers.getContractFactory('MockContractV1');
        const MockContractV2Factory = await ethers.getContractFactory('MockContractV2');

        mockContractV1 = (await MockContractV1Factory.deploy()) as MockContractV1;
        mockContractV2 = (await MockContractV2Factory.deploy()) as MockContractV2;
    });

    it('MockContractV1 tests', async () => {
        const testString = 'Test string';

        expect(await mockContractV1.version()).to.equal(1);

        await expect(mockContractV1.emitStringNoParam())
            .to.emit(mockContractV1, 'CreateString')
            .withArgs(user.address, 1000, 'Emited hardcoded string', 2000);

        await expect(mockContractV1.emitString(testString))
            .to.emit(mockContractV1, 'CreateString')
            .withArgs(user.address, 1000, testString, 2000);
    });

    it('MockContractV2 tests', async () => {
        const testString = 'Test string';

        expect(await mockContractV2.version()).to.equal(2);

        await expect(mockContractV2.emitStringNoParam())
            .to.emit(mockContractV2, 'CreateString')
            .withArgs(user.address, 1000, 'Emited hardcoded string', 2000);

        await expect(mockContractV2.emitString(testString))
            .to.emit(mockContractV2, 'CreateString')
            .withArgs(user.address, 1000, testString, 2000);
    });
});
