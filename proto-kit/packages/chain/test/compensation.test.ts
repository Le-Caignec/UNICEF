import 'reflect-metadata';
import { TestingAppChain } from '@proto-kit/sdk';
import { Field, PrivateKey, PublicKey, Signature, UInt64 } from 'o1js';
import { Balances } from '../src/balances';
import { Admin } from '../src/admin';
import { ADMIN_INITIAL_BALANCE, Compensation, CompensationProof, CompensationPublicOutput, canClaim } from '../src/compensation';
import { log } from '@proto-kit/common';
import { Pickles } from 'o1js/dist/node/snarky';
import { dummyBase64Proof } from 'o1js/dist/node/lib/proof_system';

log.setLevel('ERROR');

const DISASTER_ORACLE_PRIVATE_KEY = 'EKDzXrLyjHVJgsXH6sXx4CJ6cqZqEwst8Vhds9k4H1Fo6AzQBtvH';
const DISASTER_ORACLE_PUBLIC_KEY = 'B62qqLzJcD4R8uSuZXuAyhFRc6BqALqQ7g2LhV8Xe8ZpmDH1JrueqdB';
const PHONE_ORACLE_PRIVATE_KEY =
'EKEWUJzR4RAH6VajUv5Ni9mGs3Sc7gf9Xrp5qctPJh4kZw362kak';
const PHONE_ORACLE_PUBLIC_KEY = 'B62qnHWT9s9YiyzDBvEKKii4ocyjd5sujP9KCojK6BcCoHV6wujDBQo';

describe('Compensation', () => {

    // Declare
    let appChain: TestingAppChain<{
        Balances: typeof Balances;
        Compensation: typeof Compensation;
        Admin: typeof Admin;
    }>;
    let compensation: Compensation;
    let balances: Balances;
    let admin: Admin;
    const alicePrivateKey = PrivateKey.random();
    const alice = alicePrivateKey.toPublicKey();
    // const key = Poseidon.hash(alice.toFields());
    
    beforeEach(async () => {
        await startChainAndResolveRuntime();
    });

    it('should Add an admin to the contract',async () => {
        const adminBefore = await appChain.query.runtime.Admin.admin.get();
        expect(adminBefore).toEqual(undefined);
        const adminAddress = PrivateKey.random().toPublicKey();
        const tx = await appChain.transaction(alice, () => {
            compensation.setAdmin(adminAddress);
        });
        await tx.sign();
        await tx.send();
        const block = await appChain.produceBlock();
        expect(block?.txs[0].status).toBe(true);
        const adminAfter = await appChain.query.runtime.Admin.admin.get();
        expect(adminAfter).toEqual(adminAddress);
        const adminBalance = await appChain.query.runtime.Balances.balances.get(adminAddress);
        expect(adminBalance?.toBigInt()).toBe(ADMIN_INITIAL_BALANCE);
    }, 1_000_000);

    it('should fail in case of calling the admin set up twice ',async ()=> {
        const adminPublicKey = PrivateKey.random().toPublicKey();
        const tx1 = await appChain.transaction(alice, () => {
            compensation.setAdmin(adminPublicKey);
        });
        await tx1.sign();
        await tx1.send();
        const block1 = await appChain.produceBlock();
        expect(block1?.txs[0].status).toBe(true);

        const tx2 = await appChain.transaction(alice, () => {
            compensation.setAdmin(adminPublicKey);
        });
        await tx2.sign();
        await tx2.send();
        const block2 = await appChain.produceBlock();
        expect(block2?.txs[0].status).toBe(false);
        expect(block2?.txs[0].statusMessage).toBe("Admin key is already set");

        const adminAfter = await appChain.query.runtime.Admin.admin.get();
        expect(adminAfter).toEqual(adminPublicKey);
    }, 1_000_000);

    it('should be able to change admin to the contract', async ()=> {
        const adminPublicKey = alice; // Loaded as signer.
        const newAdminPublicKey = PrivateKey.random().toPublicKey();

        const tx = await appChain.transaction(alice, () => {
            compensation.setAdmin(adminPublicKey);
        });
        await tx.sign();
        await tx.send();
        const block = await appChain.produceBlock();

        const adminBefore = await appChain.query.runtime.Admin.admin.get();
        expect(block?.txs[0].status).toBe(true);
        expect(adminBefore).toEqual(adminPublicKey);

        const tx2 = await appChain.transaction(alice, () => {
            compensation.changeAdmin(newAdminPublicKey);
        });
        await tx2.sign();
        await tx2.send();
        const block2 = await appChain.produceBlock();
        expect(block2?.txs[0].status).toBe(true);

        const newAdmin = await appChain.query.runtime.Admin.admin.get();
        expect(newAdmin).toEqual(newAdminPublicKey);
    }, 1_000_000);

    it('should fail to change admin to the contract if not admin sender', async ()=> {
        const adminPublicKey = alice;
        const tx = await appChain.transaction(alice, () => {
            compensation.setAdmin(adminPublicKey);
        });
        await tx.sign();
        await tx.send();
        const block = await appChain.produceBlock();

        const adminAfter = await appChain.query.runtime.Admin.admin.get();
        expect(block?.txs[0].status).toBe(true);
        expect(adminAfter).toEqual(adminPublicKey);

        const bobPrivateKey = PrivateKey.random();
        const bob = bobPrivateKey.toPublicKey();
        appChain.setSigner(bobPrivateKey);

        const tx2 = await appChain.transaction(bob, () => {
            compensation.changeAdmin(adminPublicKey);
        });
        await tx2.sign();
        await tx2.send();
        const block2 = await appChain.produceBlock();
        expect(block2?.txs[0].status).toBe(false);
        expect(block2?.txs[0].statusMessage).toBe("You are not the admin");

        const newAdmin = await appChain.query.runtime.Admin.admin.get();
        expect(newAdmin).toEqual(adminPublicKey);
    }, 1_000_000);

    it('should setup oracles public keys', async () => {
        const adminPublicKey = alice;
        const setupAdminTx = await appChain.transaction(alice, () => {
            compensation.setAdmin(adminPublicKey);
        });
        await setupAdminTx.sign();
        await setupAdminTx.send();
        await appChain.produceBlock();
        // Send setup tx.
        const expectedDisasterOraclePublicKey: PublicKey = PublicKey.fromBase58(DISASTER_ORACLE_PUBLIC_KEY)
        const expectedPhoneOraclePublicKey: PublicKey = PublicKey.fromBase58(PHONE_ORACLE_PUBLIC_KEY)
        const setupKeysTx = await appChain.transaction(alice, () => {
            compensation.setupPublicKeys(
                expectedDisasterOraclePublicKey,
                expectedPhoneOraclePublicKey,
            );
        });
        await setupKeysTx.sign();
        await setupKeysTx.send();
        const block = await appChain.produceBlock();
        expect(block?.txs[0].status).toBe(true);
        // Check that public keys match.
        const disasterOraclePublicKey = await appChain.query.runtime.Compensation.disasterOraclePublicKey.get();
        const phoneOraclePublicKey = await appChain.query.runtime.Compensation.phoneOraclePublicKey.get();
        expect(disasterOraclePublicKey).toEqual(expectedDisasterOraclePublicKey);
        expect(phoneOraclePublicKey).toEqual(expectedPhoneOraclePublicKey);
    }, 1_000_000);

    it('should not setup oracles public keys if no admin setup', async () => {
        // Send setup tx.
        const tx = await appChain.transaction(alice, () => {
            compensation.setupPublicKeys(
                PublicKey.fromBase58(DISASTER_ORACLE_PUBLIC_KEY),
                PublicKey.fromBase58(PHONE_ORACLE_PUBLIC_KEY),
            );
        });
        await tx.sign();
        await tx.send();
        const block = await appChain.produceBlock();
        // Check tx status.
        expect(block?.txs[0].status).toBe(false);
        expect(block?.txs[0].statusMessage).toBe("No admin key set !");
    }, 1_000_000);

    it('should allow claiming if a valid proof is provided', async () => {
        // Setup admin.
        const adminPublicKey = alice;
        const disasterOraclePrivateKey = PrivateKey.fromBase58(DISASTER_ORACLE_PRIVATE_KEY);
        const phoneOraclePrivateKey = PrivateKey.fromBase58(PHONE_ORACLE_PRIVATE_KEY);
        const beneficiaryPrivateKey: PrivateKey = PrivateKey.random();
        const beneficiary: PublicKey = beneficiaryPrivateKey.toPublicKey();
        const setupAdminTx = await appChain.transaction(alice, () => {
            compensation.setAdmin(adminPublicKey);
        });
        await setupAdminTx.sign();
        await setupAdminTx.send();
        const setupAdminBlock = await appChain.produceBlock();
        expect(setupAdminBlock?.txs[0].status).toBe(true);
        // Setup public keys.
        const setupKeysTx = await appChain.transaction(alice, () => {
            compensation.setupPublicKeys(
                disasterOraclePrivateKey.toPublicKey(),
                phoneOraclePrivateKey.toPublicKey(),
            );
        });
        await setupKeysTx.sign();
        await setupKeysTx.send();
        const setupKeysBlock = await appChain.produceBlock();
        expect(setupKeysBlock?.txs[0].status).toBe(true);
        const expectedDisasterOraclePublicKey: PublicKey = PublicKey.fromBase58(DISASTER_ORACLE_PUBLIC_KEY)
        const expectedPhoneOraclePublicKey: PublicKey = PublicKey.fromBase58(PHONE_ORACLE_PUBLIC_KEY)
        expect(await appChain.query.runtime.Compensation.disasterOraclePublicKey.get()).toEqual(expectedDisasterOraclePublicKey);
        expect(await appChain.query.runtime.Compensation.phoneOraclePublicKey.get()).toEqual(expectedPhoneOraclePublicKey);
        // Create claim proof.
        // const nullifier = Nullifier.fromJSON(Nullifier.createTestNullifier(message, aliceKey));
        const disasterOraclePublicKey = await appChain.query.runtime.Compensation.disasterOraclePublicKey.get();
        const phoneOraclePublicKey = await appChain.query.runtime.Compensation.phoneOraclePublicKey.get();
        const disasterId = Field(1);
        const userSessionId: Field = Field(2);
        const amount: Field = Field(3);
        const disasterOracleSignatureSalt: Field = Field(4);
        const disasterOracleSignature: Signature = Signature.create(disasterOraclePrivateKey, [
            disasterId,
            userSessionId,
            amount,
            disasterOracleSignatureSalt,
        ]);
        const phoneNumber: Field = Field(5);
        const phoneOracleSignatureSalt: Field = Field(6);
        const phoneOracleSignature: Signature = Signature.create(phoneOraclePrivateKey, [
            userSessionId,
            phoneNumber,
            phoneOracleSignatureSalt,
        ]);
        const compensationProof = await mockProof(canClaim(
            // keys
            disasterOraclePublicKey || PublicKey.empty(),
            phoneOraclePublicKey || PublicKey.empty(),
            // disaster
            disasterId,
            userSessionId,
            amount,
            disasterOracleSignatureSalt,
            disasterOracleSignature,
            // phone number
            phoneNumber,
            phoneOracleSignatureSalt,
            phoneOracleSignature,
            // victim's pubkey
            beneficiary,
            // nullifier,
        ));
        // Check balances before.
        const beneficiaryBalanceBefore = await appChain.query.runtime.Balances.balances.get(beneficiary);
        expect(beneficiaryBalanceBefore).toEqual(undefined);
        const adminBalanceBefore = await appChain.query.runtime.Balances.balances.get(adminPublicKey);
        expect(adminBalanceBefore?.toBigInt()).toBe(ADMIN_INITIAL_BALANCE);
        // Claim
        const claimTx = await appChain.transaction(alice, () => {
            compensation.claim(compensationProof);
        });
        await claimTx.sign();
        await claimTx.send();
        const claimBlock = await appChain.produceBlock();
        expect(claimBlock?.txs[0].status).toBe(true);
        // Check balances after.
        // Beneficiary
        const beneficiaryBalanceAfter = await appChain.query.runtime.Balances.balances.get(beneficiary);        
        expect(beneficiaryBalanceAfter?.toBigInt()).toEqual(amount.toBigInt());
        // Admin
        const adminBalanceAfter = await appChain.query.runtime.Balances.balances.get(adminPublicKey);
        expect(adminBalanceAfter?.toBigInt()).toBe(BigInt(ADMIN_INITIAL_BALANCE) - amount.toBigInt());
        // const storedNullifier = await appChain.query.runtime.Compensation.nullifiers.get(
        //     compensationProof.publicOutput.nullifier
        // );
        // expect(storedNullifier?.toBoolean()).toBe(true);
    }, 1_000_000);

    // TODO
    // it('should not allow claiming if a spent nullifier is used', async () => {
    //     const nullifier = Nullifier.fromJSON(Nullifier.createTestNullifier([Field(0)], aliceKey));

    //     const compensationProof = await mockProof(canClaim(witness, nullifier));

    //     const tx = appChain.transaction(alice, () => {
    //         compensation.claim(compensationProof);
    //     });

    //     await tx.sign();
    //     await tx.send();

    //     const block = await appChain.produceBlock();

    //     const storedNullifier = await appChain.query.runtime.Compensation.nullifiers.get(
    //         compensationProof.publicOutput.nullifier
    //     );
    //     const balance = await appChain.query.runtime.Balances.balances.get(alice);

    //     expect(block?.txs[0].status).toBe(false);
    //     expect(block?.txs[0].statusMessage).toMatch(/Nullifier has already been used/);
    //     expect(storedNullifier?.toBoolean()).toBe(true);
    //     expect(balance?.toBigInt()).toBe(1000n);
    // });

    async function startChainAndResolveRuntime() {
        appChain = TestingAppChain.fromRuntime({
            modules: {
                Balances,
                Compensation,
                Admin,
            },
            config: {
                Balances: {
                    totalSupply: UInt64.from(10000),
                },
                Compensation: {},
                Admin: {}
            },
        });
        await appChain.start();
        appChain.setSigner(alicePrivateKey);
        balances = appChain.runtime.resolve('Balances');
        compensation = appChain.runtime.resolve('Compensation');
        admin = appChain.runtime.resolve('Admin');
    }

    async function mockProof(publicOutput: CompensationPublicOutput): Promise<CompensationProof> {
        const [, proof] = Pickles.proofOfBase64(await dummyBase64Proof(), 2);
        return new CompensationProof({
            proof: proof,
            maxProofsVerified: 2,
            publicInput: undefined,
            publicOutput,
        });
    }

});
