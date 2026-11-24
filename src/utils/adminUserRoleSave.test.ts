// Run with `npm test` (Node's built-in runner; no bundler, so the import carries its extension).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canSaveRoleChange } from './adminUserRoleSave.ts';

const customerSupport = { role: 'CUSTOMER_SUPPORT', businessUnit: null, requesterGroupId: null };

test('a read-only account becomes a Requester with no unit, team or sales rep code', () => {
  assert.equal(canSaveRoleChange(customerSupport, { role: 'REQUESTER' }), true);
});

test('a team chosen without a business unit cannot be saved', () => {
  assert.equal(canSaveRoleChange(customerSupport, { role: 'REQUESTER', requesterGroupId: 'grp-1' }), false);
});

test('a team with a unit picked in the row can be saved', () => {
  assert.equal(
    canSaveRoleChange(customerSupport, { role: 'REQUESTER', requesterGroupId: 'grp-1', businessUnit: 'CDG' }),
    true
  );
});

test("the account's own business unit counts for the team look-up", () => {
  assert.equal(
    canSaveRoleChange({ ...customerSupport, businessUnit: 'LSG' }, { role: 'REQUESTER', requesterGroupId: 'grp-1' }),
    true
  );
});

test('an untouched row has nothing to save', () => {
  assert.equal(canSaveRoleChange(customerSupport, {}), false);
  assert.equal(canSaveRoleChange(customerSupport, { role: 'CUSTOMER_SUPPORT' }), false);
});

test("editing an existing requester's team is not a role change, so it is not saveable here", () => {
  const requester = { role: 'REQUESTER', businessUnit: 'CDG', requesterGroupId: 'grp-1' };
  assert.equal(canSaveRoleChange(requester, { role: 'REQUESTER', requesterGroupId: 'grp-2' }), false);
});

test('a change to any other role is saveable', () => {
  assert.equal(canSaveRoleChange({ role: 'REQUESTER', businessUnit: 'CDG' }, { role: 'SALES_MANAGER' }), true);
  assert.equal(canSaveRoleChange(customerSupport, { role: 'ADMIN' }), true);
});

test('an account without a role is treated as an administrator', () => {
  assert.equal(canSaveRoleChange({ role: undefined }, { role: 'ADMIN' }), false);
  assert.equal(canSaveRoleChange({ role: undefined }, { role: 'REQUESTER' }), true);
});
