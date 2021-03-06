// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CHROME_BROWSER_ASH_SERVICE_REGISTRY_H_
#define CHROME_BROWSER_ASH_SERVICE_REGISTRY_H_

#include <string>

#include "content/public/browser/content_browser_client.h"

namespace service_manager {
class Service;
}

namespace ash_service_registry {

// Registers the set of Ash related services that run out of process.
void RegisterOutOfProcessServices(
    content::ContentBrowserClient::OutOfProcessServiceMap* services);

// Handles an incoming ServiceRequest to run a service in the browser process.
std::unique_ptr<service_manager::Service> HandleServiceRequest(
    const std::string& service_name,
    service_manager::mojom::ServiceRequest request);

// Returns true if |name| identifies an Ash related service.
bool IsAshRelatedServiceName(const std::string& name);

// Returns true if the browser should exit when service |name| quits.
bool ShouldTerminateOnServiceQuit(const std::string& name);

}  // namespace ash_service_registry

#endif  // CHROME_BROWSER_ASH_SERVICE_REGISTRY_H_
