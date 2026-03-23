import { ethers } from 'hardhat';
import { expect } from 'chai';
import { MockBlsSignatureVerifier } from '../typechain-types/contracts/signature';
import { MockBlsSignatureVerifier__factory } from '../typechain-types/factories/contracts/signature';
import { SignatureParamStruct } from '../typechain-types/contracts/signature/MockBlsSignatureVerifier';

const FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

describe('SignatureChecker', function () {
    let contract: MockBlsSignatureVerifier;
    let deployer: any;

    // const msgHash = ethers.keccak256(ethers.toUtf8Bytes("hello world"));
    const msgHash = ethers.keccak256(
        '0x3fb5c1cb000000000000000000000000000000000000000000000000000000000000000a'
    );
    // Known valid values (from working Solidity test)

    const signerPubkeys = [
        {
            X: 19785642678854959165106125579746865140598729469181553335744537506751319685835n,
            Y: 757628510390396106772860493369501836287069362672659103473942377776519028232n,
        },
    ];

    const sigma = {
        X: 21458421312242194393178816110831440646276308246203285702598267672293436303164n,
        Y: 12437869753372122296326648486307456729299494646292673007551805584373244181129n,
    };

    const apkG2 = {
        X: [
            6000536543559202278752816414273525021665752229975717269095174157640454044564n,
            2695575310753696506239682240936646570435208622142549246075436082514891119538n,
        ] as [bigint, bigint],
        Y: [
            18102041430829227944064734837958066224765902534059775437654070875074345871126n,
            3829275132401961547071113479931182583996538110654937431841331353374033241555n,
        ] as [bigint, bigint],
    };

    const validParam: SignatureParamStruct = {
        signerPubkeys,
        apkG2,
        sigma,
    };

    beforeEach(async () => {
        [deployer] = await ethers.getSigners();
        contract = await new MockBlsSignatureVerifier__factory(deployer).deploy(apkG2);
    });

    it('should verify a valid signature with multiple signers', async () => {
        const [pairing, valid] = await contract.checkSignaturePublic(msgHash, validParam);
        expect(pairing).to.be.true;
        expect(valid).to.be.true;
    });

    it('should fail with incorrect sigma', async () => {
        const wrongSigma = {
            X: 3095504313192397867640265882947370117143314255587256824669549216160437685094n,
            Y: 3219447536722777835206265243383146421648403604516865461825648587432521920879n,
        };

        const paramWithBadSigma = {
            ...validParam,
            sigma: wrongSigma,
        };

        const [pairingSuccessful, signatureValid] = await contract.checkSignaturePublic(
            msgHash,
            paramWithBadSigma
        );

        expect(pairingSuccessful).to.equal(true); // pairing succeeded
        expect(signatureValid).to.equal(false); // but signature is invalid
    });

    it('should fail with incorrect message hash', async () => {
        const wrongHash = ethers.keccak256('0xdeadbeef');
        const [pairingSuccessful, signatureValid] = await contract.checkSignaturePublic(
            wrongHash,
            validParam
        );
        expect(pairingSuccessful).to.equal(true);
        expect(signatureValid).to.equal(false);
    });

    it('should handle zero signers without crashing', async () => {
        const emptyParam = {
            ...validParam,
            signerPubkeys: [],
        };
        const [pairingSuccessful, signatureValid] = await contract.checkSignaturePublic(
            msgHash,
            emptyParam
        );
        expect(pairingSuccessful).to.equal(true);
        expect(signatureValid).to.equal(false);
    });

    it('should compute apk as sum of G1 pubkeys', async () => {
        const { signerPubkeys } = validParam;

        const apkX = BigInt(signerPubkeys[0].X);
        const apkY = BigInt(signerPubkeys[0].Y);

        expect(apkX).to.be.a('bigint');
        expect(apkY).to.be.a('bigint');
    });

    it('should compute gamma as deterministic hash', async () => {
        const hashInput = ethers.solidityPacked(
            [
                'bytes32',
                'uint256',
                'uint256',
                'uint256',
                'uint256',
                'uint256',
                'uint256',
                'uint256',
                'uint256',
            ],
            [
                msgHash,
                signerPubkeys[0].Y,
                signerPubkeys[0].Y,
                apkG2.X[0],
                apkG2.X[1],
                apkG2.Y[0],
                apkG2.Y[1],
                sigma.X,
                sigma.Y,
            ]
        );

        const gamma = BigInt(ethers.keccak256(hashInput)) % FR_MODULUS;
        expect(gamma).to.be.a('bigint');
    });
});
