// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_SIGNIN_SIGNIN_PROFILE_ATTRIBUTES_UPDATER_H_
#define CHROME_BROWSER_SIGNIN_SIGNIN_PROFILE_ATTRIBUTES_UPDATER_H_

#include "base/files/file_path.h"
#include "base/macros.h"
#include "base/scoped_observer.h"
#include "build/build_config.h"
#include "components/keyed_service/core/keyed_service.h"
#include "components/signin/core/browser/signin_error_controller.h"
#include "services/identity/public/cpp/identity_manager.h"

// This class listens to various signin events and updates the signin-related
// fields of ProfileAttributes.
class SigninProfileAttributesUpdater
    : public KeyedService,
      public SigninErrorController::Observer,
      public identity::IdentityManager::Observer {
 public:
  SigninProfileAttributesUpdater(identity::IdentityManager* identity_manager,
                                 SigninErrorController* signin_error_controller,
                                 const base::FilePath& profile_path);

  ~SigninProfileAttributesUpdater() override;

 private:
  // KeyedService:
  void Shutdown() override;

  // Updates the profile attributes on signin and signout events.
  void UpdateProfileAttributes();

  // SigninErrorController::Observer:
  void OnErrorChanged() override;

  // IdentityManager::Observer:
  void OnPrimaryAccountSet(const AccountInfo& primary_account_info) override;
  void OnPrimaryAccountCleared(
      const AccountInfo& previous_primary_account_info) override;

  identity::IdentityManager* identity_manager_;
  SigninErrorController* signin_error_controller_;
  const base::FilePath profile_path_;
  ScopedObserver<identity::IdentityManager, SigninProfileAttributesUpdater>
      identity_manager_observer_;
  ScopedObserver<SigninErrorController, SigninProfileAttributesUpdater>
      signin_error_controller_observer_;

  DISALLOW_COPY_AND_ASSIGN(SigninProfileAttributesUpdater);
};

#endif  // CHROME_BROWSER_SIGNIN_SIGNIN_PROFILE_ATTRIBUTES_UPDATER_H_
