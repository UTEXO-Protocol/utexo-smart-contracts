import { ethers } from 'hardhat';
import { expect } from 'chai';
import { MultisigProxy, Bridge, TestToken } from '../typechain-types';
import { Wallet, Interface } from 'ethers';
import { SignerWithAddress } from '@nomicfoundation/hardhat-ethers/signers';
import { getCurrentTimeFromNetwork, addSecondsToNetwork } from './util';
import {
    getMultisigDomain,
    buildBitmapAndSignatures,
    BridgeOperationTypes,
    ProposeUpdateBridgeTypes,
    ProposeSetCommissionRecipientTypes,
    ProposeSetTimelockDurationTypes,
    ProposeAdminExecuteTypes,
    ProposeUpdateEnclaveSignersTypes,
    ProposeUpdateFederationSignersTypes,
    ProposeSetTeeSelectorTypes,
    EmergencyPauseTypes,
    EmergencyUnpauseTypes,
    CancelProposalTypes,
} from './helpers/multisig-helpers';

describe('MultisigProxy', function () {
    let multisig: MultisigProxy;
    let bridgeContract: Bridge;
    let testToken: TestToken;
    let deployer: SignerWithAddress;
    let user1: SignerWithAddress;
    let commissionRecipient: SignerWithAddress;

    // 3 enclave signers, threshold 2
    const enclaveSigners: Wallet[] = [];
    // 3 federation signers, threshold 2
    const federationSigners: Wallet[] = [];

    const enclaveThreshold = 2;
    const federationThreshold = 2;
    const timelockDuration = 3600; // 1 hour

    let domain: ReturnType<typeof getMultisigDomain>;
    let chainId: bigint;

    before(async () => {
        // Create deterministic wallets for signers
        for (let i = 0; i < 3; i++) {
            enclaveSigners.push(Wallet.createRandom());
            federationSigners.push(Wallet.createRandom());
        }
    });

    beforeEach(async () => {
        [deployer, user1, commissionRecipient] = await ethers.getSigners() as SignerWithAddress[];

        // Deploy Bridge directly (no proxy)
        const BridgeFactory = await ethers.getContractFactory('Bridge');
        bridgeContract = await BridgeFactory.deploy() as Bridge;
        await bridgeContract.waitForDeployment();

        chainId = await bridgeContract.getChainId();

        // Deploy TestToken and fund Bridge for fundsOut tests
        const TestTokenFactory = await ethers.getContractFactory('TestToken');
        testToken = await TestTokenFactory.deploy(ethers.parseEther('10000')) as TestToken;
        await testToken.waitForDeployment();
        await testToken.transfer(await bridgeContract.getAddress(), ethers.parseEther('1000'));

        // Deploy MultisigProxy
        const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
        multisig = await MultisigFactory.deploy(
            await bridgeContract.getAddress(),
            enclaveSigners.map(s => s.address),
            enclaveThreshold,
            federationSigners.map(s => s.address),
            federationThreshold,
            await commissionRecipient.getAddress(),
            timelockDuration
        ) as MultisigProxy;
        await multisig.waitForDeployment();

        // Transfer Bridge ownership to MultisigProxy
        await bridgeContract.transferOwnership(await multisig.getAddress());

        domain = getMultisigDomain(await multisig.getAddress(), chainId);
    });

    async function getDeadline(offset = 84000) {
        return (await getCurrentTimeFromNetwork()) + offset;
    }

    // =========================================================================
    // Constructor
    // =========================================================================

    describe('Constructor', () => {
        it('should set initial state correctly', async () => {
            expect(await multisig.bridge()).to.equal(await bridgeContract.getAddress());
            expect(await multisig.enclaveThreshold()).to.equal(enclaveThreshold);
            expect(await multisig.federationThreshold()).to.equal(federationThreshold);
            expect(await multisig.commissionRecipient()).to.equal(await commissionRecipient.getAddress());
            expect(await multisig.timelockDuration()).to.equal(timelockDuration);
            expect(await multisig.proposalNonce()).to.equal(0);

            const signers = await multisig.getEnclaveSigners();
            expect(signers.length).to.equal(3);
            for (let i = 0; i < 3; i++) {
                expect(signers[i]).to.equal(enclaveSigners[i].address);
            }
        });

        it('should set default TEE allowed selectors', async () => {
            const fundsOutSelector = ethers.id('fundsOut(address,address,uint256,uint256,string,string)').slice(0, 10);
            expect(await multisig.teeAllowedSelectors(fundsOutSelector)).to.be.true;
        });

        it('should revert with zero bridge address', async () => {
            const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
            await expect(MultisigFactory.deploy(
                ethers.ZeroAddress,
                enclaveSigners.map(s => s.address),
                enclaveThreshold,
                federationSigners.map(s => s.address),
                federationThreshold,
                await commissionRecipient.getAddress(),
                timelockDuration
            )).to.be.revertedWithCustomError(multisig, 'ZeroBridge');
        });

        it('should revert with invalid enclave threshold', async () => {
            const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
            await expect(MultisigFactory.deploy(
                await bridgeContract.getAddress(),
                enclaveSigners.map(s => s.address),
                0,  // invalid threshold
                federationSigners.map(s => s.address),
                federationThreshold,
                await commissionRecipient.getAddress(),
                timelockDuration
            )).to.be.revertedWithCustomError(multisig, 'InvalidThreshold');
        });

        it('should revert with duplicate signers', async () => {
            const MultisigFactory = await ethers.getContractFactory('MultisigProxy');
            const dupeSigners = [enclaveSigners[0].address, enclaveSigners[0].address, enclaveSigners[1].address];
            await expect(MultisigFactory.deploy(
                await bridgeContract.getAddress(),
                dupeSigners,
                2,
                federationSigners.map(s => s.address),
                federationThreshold,
                await commissionRecipient.getAddress(),
                timelockDuration
            )).to.be.revertedWithCustomError(multisig, 'DuplicateSigner');
        });
    });

    // =========================================================================
    // TEE execute()
    // =========================================================================

    describe('TEE execute()', () => {
        it('should execute fundsOut with valid enclave signatures', async () => {
            const deadline = await getDeadline();
            const callData = bridgeContract.interface.encodeFunctionData('fundsOut', [
                await testToken.getAddress(),
                await user1.getAddress(),
                ethers.parseEther('1'),
                1001,
                'rgb',
                'rgb:addr123',
            ]);
            const selector = callData.slice(0, 10) as `0x${string}`;
            const nonce = await multisig.getNonce(selector);

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                enclaveSigners,
                [0, 1], // signers at index 0 and 1
                domain,
                BridgeOperationTypes,
                { selector, callData, nonce, deadline }
            );

            await expect(multisig.execute(callData, nonce, deadline, bitmap, signatures))
                .to.emit(multisig, 'Executed')
                .withArgs(selector, nonce, bitmap);
        });

        it('should increment per-selector nonce after execute', async () => {
            const deadline = await getDeadline();
            const callData = bridgeContract.interface.encodeFunctionData('fundsOut', [
                await testToken.getAddress(),
                await user1.getAddress(),
                ethers.parseEther('1'),
                1001,
                'rgb',
                'rgb:addr123',
            ]);
            const selector = callData.slice(0, 10) as `0x${string}`;

            expect(await multisig.getNonce(selector)).to.equal(0);

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                enclaveSigners, [0, 2], domain,
                BridgeOperationTypes,
                { selector, callData, nonce: 0n, deadline }
            );
            await multisig.execute(callData, 0, deadline, bitmap, signatures);

            expect(await multisig.getNonce(selector)).to.equal(1);
        });

        it('should revert with expired deadline', async () => {
            const pastDeadline = (await getCurrentTimeFromNetwork()) - 1;
            const callData = '0x12345678';

            await expect(
                multisig.execute(callData, 0, pastDeadline, 0, [])
            ).to.be.revertedWithCustomError(multisig, 'Expired');
        });

        it('should revert with disallowed selector', async () => {
            const deadline = await getDeadline();
            const bridgeIface = new Interface(['function pause()']);
            const callData = bridgeIface.encodeFunctionData('pause');
            const selector = callData.slice(0, 10) as `0x${string}`;

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                enclaveSigners, [0, 1], domain,
                BridgeOperationTypes,
                { selector, callData, nonce: 0n, deadline }
            );

            await expect(
                multisig.execute(callData, 0, deadline, bitmap, signatures)
            ).to.be.revertedWithCustomError(multisig, 'SelectorNotAllowed');
        });

        it('should revert with invalid nonce', async () => {
            const deadline = await getDeadline();
            const callData = bridgeContract.interface.encodeFunctionData('fundsOut', [
                await testToken.getAddress(), await user1.getAddress(), ethers.parseEther('1'), 1001, 'rgb', 'addr',
            ]);
            const selector = callData.slice(0, 10) as `0x${string}`;
            const wrongNonce = 999n;

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                enclaveSigners, [0, 1], domain,
                BridgeOperationTypes,
                { selector, callData, nonce: wrongNonce, deadline }
            );

            await expect(
                multisig.execute(callData, wrongNonce, deadline, bitmap, signatures)
            ).to.be.revertedWithCustomError(multisig, 'InvalidNonce');
        });

        it('should revert with below-threshold signatures', async () => {
            const deadline = await getDeadline();
            const callData = bridgeContract.interface.encodeFunctionData('fundsOut', [
                await testToken.getAddress(), await user1.getAddress(), ethers.parseEther('1'), 1001, 'rgb', 'addr',
            ]);
            const selector = callData.slice(0, 10) as `0x${string}`;

            // Only 1 signature but threshold is 2
            const { bitmap, signatures } = await buildBitmapAndSignatures(
                enclaveSigners, [0], domain,
                BridgeOperationTypes,
                { selector, callData, nonce: 0n, deadline }
            );

            await expect(
                multisig.execute(callData, 0, deadline, bitmap, signatures)
            ).to.be.revertedWithCustomError(multisig, 'BelowThreshold');
        });

        it('should revert with invalid signature', async () => {
            const deadline = await getDeadline();
            const callData = bridgeContract.interface.encodeFunctionData('fundsOut', [
                await testToken.getAddress(), await user1.getAddress(), ethers.parseEther('1'), 1001, 'rgb', 'addr',
            ]);
            const selector = callData.slice(0, 10) as `0x${string}`;

            // Sign with federation signers instead of enclave signers
            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                BridgeOperationTypes,
                { selector, callData, nonce: 0n, deadline }
            );

            await expect(
                multisig.execute(callData, 0, deadline, bitmap, signatures)
            ).to.be.revertedWithCustomError(multisig, 'InvalidSignature');
        });
    });

    // =========================================================================
    // verifyEnclaveSignature()
    // =========================================================================

    describe('verifyEnclaveSignature()', () => {
        it('should return true for valid signature', async () => {
            const digest = ethers.keccak256(ethers.toUtf8Bytes('test message'));
            const signature = await enclaveSigners[0].signMessage(ethers.getBytes(digest));
            const ethDigest = ethers.hashMessage(ethers.getBytes(digest));

            const result = await multisig.verifyEnclaveSignature(ethDigest, signature, 0);
            expect(result).to.be.true;
        });

        it('should return false for wrong signer index', async () => {
            const digest = ethers.keccak256(ethers.toUtf8Bytes('test message'));
            const signature = await enclaveSigners[0].signMessage(ethers.getBytes(digest));
            const ethDigest = ethers.hashMessage(ethers.getBytes(digest));

            // Signed by signer[0] but checking against signer[1]
            const result = await multisig.verifyEnclaveSignature(ethDigest, signature, 1);
            expect(result).to.be.false;
        });

        it('should revert with out-of-range index', async () => {
            const digest = ethers.keccak256(ethers.toUtf8Bytes('test'));
            const signature = await enclaveSigners[0].signMessage(ethers.getBytes(digest));

            await expect(
                multisig.verifyEnclaveSignature(digest, signature, 99)
            ).to.be.revertedWithCustomError(multisig, 'IndexOutOfRange');
        });
    });

    // =========================================================================
    // Emergency pause / unpause
    // =========================================================================

    describe('Emergency pause/unpause', () => {
        it('should pause the bridge instantly', async () => {
            const deadline = await getDeadline();
            const nonce = await multisig.proposalNonce();

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                EmergencyPauseTypes,
                { nonce, deadline }
            );

            await expect(multisig.emergencyPause(nonce, deadline, bitmap, signatures))
                .to.emit(multisig, 'EmergencyPaused')
                .withArgs(nonce, bitmap);

            expect(await bridgeContract.paused()).to.be.true;
        });

        it('should unpause the bridge instantly', async () => {
            // First pause
            const deadline = await getDeadline();
            let nonce = await multisig.proposalNonce();

            let { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                EmergencyPauseTypes,
                { nonce, deadline }
            );
            await multisig.emergencyPause(nonce, deadline, bitmap, signatures);

            // Then unpause
            nonce = await multisig.proposalNonce();
            ({ bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 2], domain,
                EmergencyUnpauseTypes,
                { nonce, deadline }
            ));
            await expect(multisig.emergencyUnpause(nonce, deadline, bitmap, signatures))
                .to.emit(multisig, 'EmergencyUnpaused');

            expect(await bridgeContract.paused()).to.be.false;
        });

        it('should increment proposalNonce', async () => {
            const deadline = await getDeadline();
            expect(await multisig.proposalNonce()).to.equal(0);

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                EmergencyPauseTypes,
                { nonce: 0n, deadline }
            );
            await multisig.emergencyPause(0, deadline, bitmap, signatures);

            expect(await multisig.proposalNonce()).to.equal(1);
        });

        it('should revert with invalid federation signatures', async () => {
            const deadline = await getDeadline();
            const nonce = await multisig.proposalNonce();

            // Sign with enclave signers instead of federation
            const { bitmap, signatures } = await buildBitmapAndSignatures(
                enclaveSigners, [0, 1], domain,
                EmergencyPauseTypes,
                { nonce, deadline }
            );

            await expect(
                multisig.emergencyPause(nonce, deadline, bitmap, signatures)
            ).to.be.revertedWithCustomError(multisig, 'InvalidSignature');
        });
    });

    // =========================================================================
    // Federation propose + execute proposal (two-phase timelock)
    // =========================================================================

    describe('Two-phase timelock', () => {
        it('should propose and execute updateBridge after timelock', async () => {
            const deadline = await getDeadline();
            const nonce = await multisig.proposalNonce();
            const newBridge = '0x1234567890123456789012345678901234567890';

            // Phase 1: Propose
            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                ProposeUpdateBridgeTypes,
                { newBridge, nonce, deadline }
            );

            const tx = await multisig.proposeUpdateBridge(
                newBridge, nonce, deadline, bitmap, signatures
            );
            const receipt = await tx.wait();

            // Extract proposalId from event
            const event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            const proposalId = event.args[0];

            // Verify proposal is pending
            const proposal = await multisig.getProposal(proposalId);
            expect(proposal.status).to.equal(1); // Pending

            // Phase 2: Wait for timelock then execute
            await addSecondsToNetwork(timelockDuration + 1);

            const opData = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [newBridge]);
            await expect(multisig.executeProposal(proposalId, opData))
                .to.emit(multisig, 'ProposalExecuted');

            expect(await multisig.bridge()).to.equal(newBridge);
        });

        it('should revert executeProposal before timelock expires', async () => {
            const deadline = await getDeadline();
            const nonce = await multisig.proposalNonce();
            const newBridge = '0x1234567890123456789012345678901234567890';

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                ProposeUpdateBridgeTypes,
                { newBridge, nonce, deadline }
            );

            const tx = await multisig.proposeUpdateBridge(
                newBridge, nonce, deadline, bitmap, signatures
            );
            const receipt = await tx.wait();
            const event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            const proposalId = event.args[0];

            // Try to execute immediately (before timelock)
            const opData = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [newBridge]);
            await expect(
                multisig.executeProposal(proposalId, opData)
            ).to.be.revertedWithCustomError(multisig, 'TimelockActive');
        });

        it('should revert executeProposal with wrong opData', async () => {
            const deadline = await getDeadline();
            const nonce = await multisig.proposalNonce();
            const newBridge = '0x1234567890123456789012345678901234567890';

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                ProposeUpdateBridgeTypes,
                { newBridge, nonce, deadline }
            );

            const tx = await multisig.proposeUpdateBridge(
                newBridge, nonce, deadline, bitmap, signatures
            );
            const receipt = await tx.wait();
            const event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            const proposalId = event.args[0];

            await addSecondsToNetwork(timelockDuration + 1);

            // Wrong data
            const wrongOpData = ethers.AbiCoder.defaultAbiCoder().encode(
                ['address'],
                ['0x0000000000000000000000000000000000000001']
            );
            await expect(
                multisig.executeProposal(proposalId, wrongOpData)
            ).to.be.revertedWithCustomError(multisig, 'DataMismatch');
        });

        it('should revert if proposal deadline has passed', async () => {
            // Use a short deadline
            const shortDeadline = (await getCurrentTimeFromNetwork()) + timelockDuration + 100;
            const nonce = await multisig.proposalNonce();
            const newBridge = '0x1234567890123456789012345678901234567890';

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                ProposeUpdateBridgeTypes,
                { newBridge, nonce, deadline: shortDeadline }
            );

            const tx = await multisig.proposeUpdateBridge(
                newBridge, nonce, shortDeadline, bitmap, signatures
            );
            const receipt = await tx.wait();
            const event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            const proposalId = event.args[0];

            // Fast-forward past the deadline
            await addSecondsToNetwork(timelockDuration + 200);

            const opData = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [newBridge]);
            await expect(
                multisig.executeProposal(proposalId, opData)
            ).to.be.revertedWithCustomError(multisig, 'ProposalExpired');
        });

        it('should propose and execute setCommissionRecipient', async () => {
            const deadline = await getDeadline();
            const nonce = await multisig.proposalNonce();
            const newRecipient = await user1.getAddress();

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [1, 2], domain,
                ProposeSetCommissionRecipientTypes,
                { newRecipient, nonce, deadline }
            );

            const tx = await multisig.proposeSetCommissionRecipient(
                newRecipient, nonce, deadline, bitmap, signatures
            );
            const receipt = await tx.wait();
            const event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            const proposalId = event.args[0];

            await addSecondsToNetwork(timelockDuration + 1);

            const opData = ethers.AbiCoder.defaultAbiCoder().encode(['address'], [newRecipient]);
            await multisig.executeProposal(proposalId, opData);

            expect(await multisig.commissionRecipient()).to.equal(newRecipient);
        });

        it('should propose and execute setTimelockDuration', async () => {
            const deadline = await getDeadline();
            const nonce = await multisig.proposalNonce();
            const newDuration = 7200; // 2 hours

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 2], domain,
                ProposeSetTimelockDurationTypes,
                { newDuration, nonce, deadline }
            );

            const tx = await multisig.proposeSetTimelockDuration(
                newDuration, nonce, deadline, bitmap, signatures
            );
            const receipt = await tx.wait();
            const event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            const proposalId = event.args[0];

            await addSecondsToNetwork(timelockDuration + 1);

            const opData = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [newDuration]);
            await multisig.executeProposal(proposalId, opData);

            expect(await multisig.timelockDuration()).to.equal(newDuration);
        });

        it('should reject deadline too far in the future', async () => {
            const nonce = await multisig.proposalNonce();
            const now = await getCurrentTimeFromNetwork();
            const tooFarDeadline = now + 31 * 24 * 3600; // > 30 days
            const newBridge = '0x1234567890123456789012345678901234567890';

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                ProposeUpdateBridgeTypes,
                { newBridge, nonce, deadline: tooFarDeadline }
            );

            await expect(
                multisig.proposeUpdateBridge(newBridge, nonce, tooFarDeadline, bitmap, signatures)
            ).to.be.revertedWithCustomError(multisig, 'DeadlineTooFar');
        });
    });

    // =========================================================================
    // Cancel proposal
    // =========================================================================

    describe('Cancel proposal', () => {
        it('should cancel a pending proposal', async () => {
            const deadline = await getDeadline();
            let nonce = await multisig.proposalNonce();
            const newBridge = '0x1234567890123456789012345678901234567890';

            // Create proposal
            const { bitmap: proposeBitmap, signatures: proposeSigs } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                ProposeUpdateBridgeTypes,
                { newBridge, nonce, deadline }
            );
            const tx = await multisig.proposeUpdateBridge(
                newBridge, nonce, deadline, proposeBitmap, proposeSigs
            );
            const receipt = await tx.wait();
            const event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            const proposalId = event.args[0];

            // Cancel it
            nonce = await multisig.proposalNonce();
            const { bitmap: cancelBitmap, signatures: cancelSigs } = await buildBitmapAndSignatures(
                federationSigners, [0, 2], domain,
                CancelProposalTypes,
                { proposalId, nonce, deadline }
            );

            await expect(multisig.cancelProposal(proposalId, nonce, deadline, cancelBitmap, cancelSigs))
                .to.emit(multisig, 'ProposalCancelled')
                .withArgs(proposalId);

            // Verify it's cancelled
            const proposal = await multisig.getProposal(proposalId);
            expect(proposal.status).to.equal(3); // Cancelled
        });

        it('should revert cancel on non-pending proposal', async () => {
            const deadline = await getDeadline();
            const nonce = await multisig.proposalNonce();
            const fakeProposalId = ethers.keccak256(ethers.toUtf8Bytes('nonexistent'));

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                CancelProposalTypes,
                { proposalId: fakeProposalId, nonce, deadline }
            );

            await expect(
                multisig.cancelProposal(fakeProposalId, nonce, deadline, bitmap, signatures)
            ).to.be.revertedWithCustomError(multisig, 'NotPending');
        });
    });

    // =========================================================================
    // ProposeAdminExecute (generic bridge call via timelock)
    // =========================================================================

    describe('proposeAdminExecute', () => {
        it('should execute arbitrary bridge call via timelock', async () => {
            const deadline = await getDeadline();
            const nonce = await multisig.proposalNonce();

            // Propose calling pause() on Bridge
            const bridgeIface = new Interface(['function pause()']);
            const callData = bridgeIface.encodeFunctionData('pause');
            const selector = callData.slice(0, 10) as `0x${string}`;

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                ProposeAdminExecuteTypes,
                { selector, callData, nonce, deadline }
            );

            const tx = await multisig.proposeAdminExecute(
                callData, nonce, deadline, bitmap, signatures
            );
            const receipt = await tx.wait();
            const event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            const proposalId = event.args[0];

            await addSecondsToNetwork(timelockDuration + 1);

            // opData for AdminExecute = raw callData
            await multisig.executeProposal(proposalId, callData);

            expect(await bridgeContract.paused()).to.be.true;
        });
    });

    // =========================================================================
    // Remaining propose types
    // =========================================================================

    describe('proposeUpdateEnclaveSigners', () => {
        it('should update enclave signers via timelock', async () => {
            const deadline = await getDeadline();
            const nonce = await multisig.proposalNonce();
            const newSigners = [
                ethers.Wallet.createRandom().address,
                ethers.Wallet.createRandom().address,
            ];
            const newThreshold = 1;

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                ProposeUpdateEnclaveSignersTypes,
                { newSigners, newThreshold, nonce, deadline }
            );

            const tx = await multisig.proposeUpdateEnclaveSigners(
                newSigners, newThreshold, nonce, deadline, bitmap, signatures
            );
            const receipt = await tx.wait();
            const event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            const proposalId = event.args[0];

            await addSecondsToNetwork(timelockDuration + 1);

            const opData = ethers.AbiCoder.defaultAbiCoder().encode(
                ['address[]', 'uint256'],
                [newSigners, newThreshold]
            );
            await expect(multisig.executeProposal(proposalId, opData))
                .to.emit(multisig, 'EnclaveSignersUpdated')
                .withArgs(newSigners, newThreshold);

            const updated = await multisig.getEnclaveSigners();
            expect(updated.length).to.equal(2);
            expect(await multisig.enclaveThreshold()).to.equal(newThreshold);
        });
    });

    describe('proposeUpdateFederationSigners', () => {
        it('should update federation signers via timelock', async () => {
            const deadline = await getDeadline();
            const nonce = await multisig.proposalNonce();
            const newSigners = [
                ethers.Wallet.createRandom().address,
                ethers.Wallet.createRandom().address,
                ethers.Wallet.createRandom().address,
            ];
            const newThreshold = 2;

            const { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 2], domain,
                ProposeUpdateFederationSignersTypes,
                { newSigners, newThreshold, nonce, deadline }
            );

            const tx = await multisig.proposeUpdateFederationSigners(
                newSigners, newThreshold, nonce, deadline, bitmap, signatures
            );
            const receipt = await tx.wait();
            const event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            const proposalId = event.args[0];

            await addSecondsToNetwork(timelockDuration + 1);

            const opData = ethers.AbiCoder.defaultAbiCoder().encode(
                ['address[]', 'uint256'],
                [newSigners, newThreshold]
            );
            await expect(multisig.executeProposal(proposalId, opData))
                .to.emit(multisig, 'FederationSignersUpdated')
                .withArgs(newSigners, newThreshold);

            const updated = await multisig.getFederationSigners();
            expect(updated.length).to.equal(3);
            expect(await multisig.federationThreshold()).to.equal(newThreshold);
        });
    });

    describe('proposeSetTeeAllowedSelector', () => {
        it('should add and remove TEE allowed selector via timelock', async () => {
            const pauseSelector = '0x8456cb59'; // pause()
            expect(await multisig.teeAllowedSelectors(pauseSelector)).to.be.false;

            // Add selector
            const deadline = await getDeadline();
            let nonce = await multisig.proposalNonce();

            let { bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 1], domain,
                ProposeSetTeeSelectorTypes,
                { selector: pauseSelector, allowed: true, nonce, deadline }
            );

            let tx = await multisig.proposeSetTeeAllowedSelector(
                pauseSelector, true, nonce, deadline, bitmap, signatures
            );
            let receipt = await tx.wait();
            let event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            let proposalId = event.args[0];

            await addSecondsToNetwork(timelockDuration + 1);

            let opData = ethers.AbiCoder.defaultAbiCoder().encode(
                ['bytes4', 'bool'],
                [pauseSelector, true]
            );
            await multisig.executeProposal(proposalId, opData);
            expect(await multisig.teeAllowedSelectors(pauseSelector)).to.be.true;

            // Remove selector
            nonce = await multisig.proposalNonce();
            ({ bitmap, signatures } = await buildBitmapAndSignatures(
                federationSigners, [0, 2], domain,
                ProposeSetTeeSelectorTypes,
                { selector: pauseSelector, allowed: false, nonce, deadline }
            ));

            tx = await multisig.proposeSetTeeAllowedSelector(
                pauseSelector, false, nonce, deadline, bitmap, signatures
            );
            receipt = await tx.wait();
            event = receipt!.logs.find(
                (log: any) => log.fragment?.name === 'ProposalCreated'
            ) as any;
            proposalId = event.args[0];

            await addSecondsToNetwork(timelockDuration + 1);

            opData = ethers.AbiCoder.defaultAbiCoder().encode(
                ['bytes4', 'bool'],
                [pauseSelector, false]
            );
            await multisig.executeProposal(proposalId, opData);
            expect(await multisig.teeAllowedSelectors(pauseSelector)).to.be.false;
        });
    });
});
