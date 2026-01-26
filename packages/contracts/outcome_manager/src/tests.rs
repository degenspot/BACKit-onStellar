#[test]
fn settles_with_quorum() {
    let env = Env::default();

    let admin = Address::generate(&env);
    let o1 = Address::generate(&env);
    let o2 = Address::generate(&env);
    let o3 = Address::generate(&env);

    let contract_id = env.register_contract(None, OutcomeManager);
    let client = OutcomeManagerClient::new(&env, &contract_id);

    client.set_admin(&admin);
    client.set_oracles(&vec![&env, o1.clone(), o2.clone(), o3.clone()]);
    client.set_quorum(&2);

    // submit same outcome from o1 & o2
    // assert finalized
}
