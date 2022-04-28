/*
 * Copyright 2021 The Backstage Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { GroupEntity, stringifyEntityRef } from '@backstage/catalog-model';
import { trim } from 'lodash';
import { GitLabClient, paginated } from './client';
import { getGroupMembers } from './users';

export type GroupNode = {
  entity: GroupEntity;
  parent: number | null;
  children: number[];
};

export type GroupAdjacency = Map<number, GroupNode>;

type Group = {
  id: number;
  web_url: string;
  name: string;
  path: string;
  description: string;
  full_name: string;
  full_path: string;
  created_at: string;
  parent_id: number | null;
};

type SharedGroup = {
  group_id: number;
  group_name: string;
  group_full_path: string;
  group_access_level: number;
  expires_at?: string;
};

/**
 * The default implementation to map a GitLab group response to a Group entity.
 */
export function defaultUserTransformer(
  group: Group,
  options: { pathDelimiter: string; groupType: string },
): GroupEntity | undefined {
  const entity: GroupEntity = {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Group',
    metadata: {
      name: group.full_path.replaceAll('/', options.pathDelimiter),
    },
    spec: {
      type: options.groupType,
      profile: {},
      children: [],
      members: [],
    },
  };

  if (group.name) {
    entity.spec!.profile!.displayName = group.name;
  }
  if (group.description) {
    entity.metadata!.description = group.description;
  }

  return entity;
}

export async function getGroups(
  client: GitLabClient,
  _id: string,
  pathDelimiter: string,
  groupType: string = 'team',
): Promise<GroupAdjacency> {
  const groups = paginated<Group>(
    options => client.pagedRequest('/groups', options),
    { per_page: 100 },
  );

  const groupAdjacency = new Map<number, GroupNode>();
  for await (const result of groups) {
    const entity = defaultUserTransformer(result, { pathDelimiter, groupType });
    if (entity) {
      if (!groupAdjacency.has(result.id)) {
        groupAdjacency.set(result.id, {
          children: [],
          parent: result.parent_id,
          entity,
        });
      }
    }
  }

  await populateChildrenMembers(client, groupAdjacency);
  mapChildrenToEntityRefs(groupAdjacency);
  return groupAdjacency;
}

export async function populateChildrenMembers(
  client: GitLabClient,
  groupAdjacency: GroupAdjacency,
) {
  // map ids of children using parent for each group node
  for (const [id, { parent, entity }] of groupAdjacency) {
    // append as child of parent if present
    if (parent !== null) {
      const parentGroupNode = groupAdjacency.get(parent);
      if (parentGroupNode) {
        parentGroupNode.children.push(id);
      }
    }
    // populate direct members
    const users = await getGroupMembers(client, String(id), {
      inherited: false,
    });
    for (const user of users) {
      entity.spec!.members!.push(
        stringifyEntityRef({
          kind: 'user',
          name: user.metadata.name,
        }),
      );
    }
    // populate direct members of shared_with_groups
    const sharedWithGroups = await getSharedWithGroupsIDs(client, String(id));
    for (const sharedID of sharedWithGroups) {
      // populate direct members
      const sharedGroupUsers = await getGroupMembers(client, sharedID, {
        inherited: false,
      });
      for (const user of sharedGroupUsers) {
        entity.spec!.members!.push(
          stringifyEntityRef({
            kind: 'user',
            name: user.metadata.name,
          }),
        );
      }
    }
  }
}

async function getSharedWithGroupsIDs(
  client: GitLabClient,
  id: string,
): Promise<string[]> {
  const response = await client.request(`/groups/${encodeURIComponent(id)}`);
  const { shared_with_groups } = await response.json();
  if (shared_with_groups) {
    return shared_with_groups.map((group: SharedGroup) =>
      String(group.group_id),
    );
  }
  return [];
}

function mapChildrenToEntityRefs(groupAdjacency: GroupAdjacency) {
  // map entity references of children from ids
  for (const [_, { entity, children }] of groupAdjacency) {
    for (const child of children) {
      const childEntity = groupAdjacency.get(child)?.entity;
      if (childEntity) {
        entity.spec!.children!.push(
          stringifyEntityRef({
            kind: 'group',
            name: childEntity.metadata!.name,
          }),
        );
      }
    }
  }
}

export function parseGitLabGroupUrl(
  url: string,
  baseUrl?: string,
): null | string {
  let path = getGroupPathComponents(url, baseUrl);

  // handle "/" pathname resulting in an array with the empty string
  if (path.length < 1) {
    return null; // no group path
  }

  if (path.length >= 1) {
    // handle reserved groups keyword if present
    if (path[0] === 'groups') {
      path = path.slice(1);
    }

    // group path cannot be empty after /groups/
    if (path.length === 0) {
      throw new Error('GitLab group URL is missing a group path');
    }

    // consume each path component until /-/ which is used to delimit sub-pages
    const components = [];
    for (const component of path) {
      if (component === '-') {
        break;
      }
      components.push(component);
    }
    return components.join('/');
  }

  throw new Error('GitLab group URL is invalid');
}

export function getGroupPathComponents(
  url: string,
  baseUrl?: string,
): string[] {
  // split target url into group path components
  const trimmedPathName = trim(new URL(url).pathname, '/');
  let path = trimmedPathName ? trimmedPathName.split('/') : [];

  if (baseUrl) {
    // split base url into path components
    const trimmedBasePathName = trim(new URL(baseUrl).pathname, '/');
    const basePath = trimmedBasePathName ? trimmedBasePathName.split('/') : [];

    // ensure base url path components are a subset of the group path
    if (!basePath.every((component, index) => component === path[index])) {
      throw new Error(
        `The GitLab base URL is not a substring of the GitLab target group URL: base: ${baseUrl}, target: ${url}`,
      );
    }
    // remove base url path components from target url group path components
    path = path.slice(basePath.length);
  }

  if (path.length === 1 && path[0].length === 0) {
    path.pop();
  }

  return path;
}
