// Copyright 2018 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#ifndef CONTENT_BROWSER_BACKGROUND_FETCH_STORAGE_CACHE_ENTRY_HANDLER_IMPL_H_
#define CONTENT_BROWSER_BACKGROUND_FETCH_STORAGE_CACHE_ENTRY_HANDLER_IMPL_H_

#include "content/browser/cache_storage/cache_storage_cache_entry_handler.h"

#include "content/browser/cache_storage/cache_storage_cache.h"

namespace content {
namespace background_fetch {

class CacheEntryHandlerImpl : public CacheStorageCacheEntryHandler {
 public:
  explicit CacheEntryHandlerImpl(
      base::WeakPtr<storage::BlobStorageContext> blob_context);

  ~CacheEntryHandlerImpl() override;

  // CacheStorageCacheEntryHandler implementation:
  std::unique_ptr<PutContext> CreatePutContext(
      blink::mojom::FetchAPIRequestPtr request,
      blink::mojom::FetchAPIResponsePtr response) override;
  void PopulateResponseBody(scoped_refptr<BlobDataHandle> data_handle,
                            blink::mojom::FetchAPIResponse* response) override;
  void PopulateRequestBody(scoped_refptr<BlobDataHandle> data_handle,
                           blink::mojom::FetchAPIRequest* request) override;

 private:
  void PopulateBody(scoped_refptr<BlobDataHandle> data_handle,
                    const blink::mojom::SerializedBlobPtr& blob,
                    CacheStorageCache::EntryIndex index);

  base::WeakPtr<CacheStorageCacheEntryHandler> GetWeakPtr() override;

  base::WeakPtrFactory<CacheEntryHandlerImpl> weak_ptr_factory_;

  DISALLOW_COPY_AND_ASSIGN(CacheEntryHandlerImpl);
};

}  // namespace background_fetch
}  // namespace content

#endif  // CONTENT_BROWSER_BACKGROUND_FETCH_STORAGE_CACHE_ENTRY_HANDLER_IMPL_H_
