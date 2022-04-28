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

import { GroupEntity, UserEntity } from '@backstage/catalog-model';

export type GitLabProject = {
  id: number;
  default_branch?: string;
  archived: boolean;
  last_activity_at: string;
  web_url: string;
};

/**
 * GitLab API User Response
 *
 * https://docs.gitlab.com/ee/api/users.html#for-user.
 * @public
 */
export type GitLabUserResponse = {
  id: number;
  name: string;
  username: string;
  state: string;
  avatar_url: string;
  web_url: string;
  created_at: string;
  job_title: string;
  public_email?: string;
  email?: string;
  bot?: boolean;
  bio?: string;
  location?: string;
  skype?: string;
  linkedin?: string;
  twitter?: string;
  website_url?: string;
  organization?: string;
  followers?: number;
  following?: number;
};

/**
 * Transformer to map a GitLab user response to a User entity.
 *
 * @public
 */
export type UserTransformer = (options: {
  user: GitLabUserResponse;
  defaultTransformer: (user: GitLabUserResponse) => UserEntity;
}) => Promise<UserEntity | undefined>;

/**
 * Transformer to map a GitLab group response to a Group entity.
 *
 * @public
 */
export type GroupTransformer = (options: {
  group: unknown;
  defaultTransformer: (group: unknown) => GroupEntity;
}) => Promise<GroupEntity | undefined>;
