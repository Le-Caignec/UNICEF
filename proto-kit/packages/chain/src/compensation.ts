import { RuntimeModule, runtimeMethod, state, runtimeModule } from '@proto-kit/module';
import { State, StateMap, assert } from '@proto-kit/protocol';
import {
    Bool,
    Experimental,
    Field,
    Nullifier,
    PublicKey,
    Signature,
    Struct,
    UInt64,
} from 'o1js';
import { inject } from 'tsyringe';
import { Balances } from './balances';
import { Admin } from './admin';

export class CompensationPublicOutput extends Struct({
    disasterOraclePublicKey: PublicKey,
    phoneOraclePublicKey: PublicKey,
    amount: Field,
    nullifier: Field, //TODO: Rename?
}) {}

// TODO: Use unique message to prevent nullifier reuse
// hash(disasterId+phoneNumber)
export const message: Field[] = [Field(0)];

export function canClaim(
    // keys
    disasterOraclePublicKey: PublicKey,
    phoneOraclePublicKey: PublicKey,
    // disaster
    disasterId: Field,
    userSessionId: Field,
    amount: Field,
    disasterOracleSignatureSalt: Field,
    disasterOracleSignature: Signature,
    // phone number
    phoneNumber: Field,
    phoneOracleSignatureSalt: Field,
    phoneOracleSignature: Signature,
    // victim's pubkey
    nullifier: Nullifier
): CompensationPublicOutput {
    // Verify disaster oracle authorization.
    const isValidDisasterAuth = disasterOracleSignature.verify(disasterOraclePublicKey, [
        disasterId,
        userSessionId,
        amount,
        disasterOracleSignatureSalt,
    ]);
    isValidDisasterAuth.assertTrue('Invalid disaster oracle authorization');

    // Verify phone oracle authorization.
    const isValidPhoneAuth = phoneOracleSignature.verify(phoneOraclePublicKey, [
        userSessionId,
        phoneNumber,
        phoneOracleSignatureSalt,
    ]);
    isValidPhoneAuth.assertTrue('Invalid phone oracle authorization');

    nullifier.verify(message);

    return new CompensationPublicOutput({
        disasterOraclePublicKey,
        phoneOraclePublicKey,
        amount,
        nullifier: nullifier.key(),
    });
}

export const compensationZkProgram = Experimental.ZkProgram({
    publicOutput: CompensationPublicOutput,
    methods: {
        canClaim: {
            privateInputs: [
                PublicKey, // disasterOraclePublicKey
                PublicKey, // phoneOraclePublicKey
                Field, // disasterId
                Field, // userSessionId
                Field, // amount
                Field, // disasterOracleSignatureSalt
                Signature, // disasterOracleSignature
                Field, // phoneNumber
                Field, // phoneOracleSignatureSalt
                Signature, // phoneOracleSignature
                Nullifier, // hash(disasterId, phoneNumber) ??
            ],
            method: canClaim,
        },
    },
});

export class CompensationProof extends Experimental.ZkProgram.Proof(compensationZkProgram) {}

type CompensationConfig = Record<string, never>;

@runtimeModule()
export class Compensation extends RuntimeModule<CompensationConfig> {
    @state() public disasterOraclePublicKey = State.from<PublicKey>(PublicKey);
    @state() public phoneOraclePublicKey = State.from<PublicKey>(PublicKey);
    @state() public nullifiers = StateMap.from<Field, Bool>(Field, Bool);

    public constructor(
        @inject('Balances') public balancesContract: Balances,
        @inject('Admin') public adminContract: Admin,
    ) {
        super();
    }

    @runtimeMethod()
    // add random input to prevent error
    public setAdmin(rndAddrr : PublicKey) {
        this.adminContract.setAdmin();
    }

    @runtimeMethod()
    // add random input to prevent error
    public changeAdmin(newAdmin : PublicKey) {
        this.adminContract.changeAdmin(newAdmin);
    }

    @runtimeMethod()
    public setupPublicKeys(disasterOraclePublicKey: PublicKey, phoneOraclePublicKey: PublicKey) {
        this.adminContract.OnlyAdmin()
        this.disasterOraclePublicKey.set(disasterOraclePublicKey);
        this.phoneOraclePublicKey.set(phoneOraclePublicKey);
    }

    @runtimeMethod()
    public claim(compensationProof: CompensationProof) {
        compensationProof.verify();

        assert(
            Bool(compensationProof.publicOutput.disasterOraclePublicKey == this.disasterOraclePublicKey.get().value),
            'Unknown disasterOraclePublicKey from proof'
        );
        assert(
            Bool(compensationProof.publicOutput.phoneOraclePublicKey == this.phoneOraclePublicKey.get().value),
            'Unknown phoneOraclePublicKey from proof'
        );

        const isNullifierUsed = this.nullifiers.get(compensationProof.publicOutput.nullifier);

        assert(isNullifierUsed.value.not(), 'Nullifier has already been used');

        this.nullifiers.set(compensationProof.publicOutput.nullifier, Bool(true));

        // TODO use correct addresses.
        const owner: PublicKey = this.adminContract.admin.get().value;
        // compensationProof.publicOutput.nullifier.getPublicKey();
        const to: PublicKey = PublicKey.empty();
        const amount: UInt64 = UInt64.from(compensationProof.publicOutput.amount);
        this.balancesContract.sendTokens(owner, to, amount);
    }
}