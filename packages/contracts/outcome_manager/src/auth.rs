use soroban_sdk::{Env, Address};

use crate::storage::InstanceKey;

pub fn require_admin(env: &Env) {
    let admin: Address = env
        .storage()
        .instance()
        .get(&InstanceKey::Admin)
        .expect("admin not set");

    admin.require_auth();
}
