// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

// Implementation of TransformStream for Blink.  See
// https://streams.spec.whatwg.org/#ts. The implementation closely follows the
// standard, except where required for performance or integration with Blink.
// In particular, classes, methods and abstract operations are implemented in
// the same order as in the standard, to simplify side-by-side reading.

(function(global, binding, v8) {
  'use strict';

  // Private symbols. These correspond to the internal slots in the standard.
  // "[[X]]" in the standard is spelt _X in this implementation.

  const _backpressure = v8.createPrivateSymbol('[[backpressure]]');
  const _backpressureChangePromise =
      v8.createPrivateSymbol('[[backpressureChangePromise]]');
  const _readable = v8.createPrivateSymbol('[[readable]]');
  const _transformStreamController =
      v8.createPrivateSymbol('[[transformStreamController]]');
  const _writable = v8.createPrivateSymbol('[[writable]]');
  const _controlledTransformStream =
      v8.createPrivateSymbol('[[controlledTransformStream]]');

  // Unlike the version in the standard, the controller is passed to this.
  const _flushAlgorithm = v8.createPrivateSymbol('[[flushAlgorithm]]');

  // Unlike the version in the standard, the controller is passed in as the
  // second argument.
  const _transformAlgorithm = v8.createPrivateSymbol('[[transformAlgorithm]]');

  // Javascript functions. It is important to use these copies, as the ones on
  // the global object may have been overwritten. See "V8 Extras Design Doc",
  // section "Security Considerations".
  // https://docs.google.com/document/d/1AT5-T0aHGp7Lt29vPWFr2-qG8r3l9CByyvKwEuA8Ec0/edit#heading=h.9yixony1a18r
  const ObjectCreate = global.Object.create;

  const TypeError = global.TypeError;
  const RangeError = global.RangeError;

  const Promise = global.Promise;
  const thenPromise = v8.uncurryThis(Promise.prototype.then);

  // From CommonOperations.js
  const {
    createPromise,
    createRejectedPromise,
    createResolvedPromise,
    hasOwnPropertyNoThrow,
    resolvePromise,
    CreateAlgorithmFromUnderlyingMethod,
    CallOrNoop1,
    MakeSizeAlgorithmFromSizeFunction,
    PromiseCall2,
    ValidateAndNormalizeHighWaterMark
  } = binding.streamOperations;

  // User-visible strings.
  const streamErrors = binding.streamErrors;
  const errStreamTerminated = 'The transform stream has been terminated';

  let useCounted = false;

  class TransformStream {
    constructor(transformer = {},
                writableStrategy = {}, readableStrategy = {}) {
      if (!useCounted) {
        binding.countUse('TransformStreamConstructor');
        useCounted = true;
      }

      const writableSizeFunction = writableStrategy.size;
      let writableHighWaterMark = writableStrategy.highWaterMark;

      const readableSizeFunction = readableStrategy.size;
      let readableHighWaterMark = readableStrategy.highWaterMark;

      // readable and writableType are extension points for future byte streams.
      const writableType = transformer.writableType;
      if (writableType !== undefined) {
        throw new RangeError(streamErrors.invalidType);
      }

      const writableSizeAlgorithm =
          MakeSizeAlgorithmFromSizeFunction(writableSizeFunction);
      if (writableHighWaterMark === undefined) {
        writableHighWaterMark = 1;
      }
      writableHighWaterMark =
          ValidateAndNormalizeHighWaterMark(writableHighWaterMark);

      const readableType = transformer.readableType;
      if (readableType !== undefined) {
        throw new RangeError(streamErrors.invalidType);
      }

      const readableSizeAlgorithm =
          MakeSizeAlgorithmFromSizeFunction(readableSizeFunction);
      if (readableHighWaterMark === undefined) {
        readableHighWaterMark = 0;
      }
      readableHighWaterMark =
          ValidateAndNormalizeHighWaterMark(readableHighWaterMark);

      const startPromise = createPromise();
      InitializeTransformStream(
          this, startPromise, writableHighWaterMark, writableSizeAlgorithm,
          readableHighWaterMark, readableSizeAlgorithm);
      SetUpTransformStreamDefaultControllerFromTransformer(this, transformer);
      const startResult = CallOrNoop1(
          transformer, 'start', this[_transformStreamController],
          'transformer.start');
      resolvePromise(startPromise, startResult);
    }

    get readable() {
      if (!IsTransformStream(this)) {
        throw new TypeError(streamErrors.illegalInvocation);
      }

      return this[_readable];
    }

    get writable() {
      if (!IsTransformStream(this)) {
        throw new TypeError(streamErrors.illegalInvocation);
      }

      return this[_writable];
    }
  }

  const TransformStream_prototype = TransformStream.prototype;

  // The controller is passed to |transformAlgorithm| and |flushAlgorithm|,
  // unlike in the standard.
  function CreateTransformStream(
      startAlgorithm, transformAlgorithm, flushAlgorithm, writableHighWaterMark,
      writableSizeAlgorithm, readableHighWaterMark, readableSizeAlgorithm) {
    if (writableHighWaterMark === undefined) {
      writableHighWaterMark = 1;
    }
    if (writableSizeAlgorithm === undefined) {
      writableSizeAlgorithm = () => 1;
    }
    if (readableHighWaterMark === undefined) {
      readableHighWaterMark = 0;
    }
    if (readableSizeAlgorithm === undefined) {
      readableSizeAlgorithm = () => 1;
    }
    // assert(
    //     typeof writableHighWaterMark === 'number' &&
    //     writableHighWaterMark >= 0,
    //     '! IsNonNegativeNumber(_writableHighWaterMark_) is *true*');
    // assert(
    //     typeof readableHighWaterMark === 'number' &&
    //     readableHighWaterMark >= 0,
    //     '! IsNonNegativeNumber(_readableHighWaterMark_) is true');
    const stream = ObjectCreate(TransformStream_prototype);
    const startPromise = createPromise();
    InitializeTransformStream(
        stream, startPromise, writableHighWaterMark, writableSizeAlgorithm,
        readableHighWaterMark, readableSizeAlgorithm);
    const controller = ObjectCreate(TransformStreamDefaultController_prototype);
    SetUpTransformStreamDefaultController(
        stream, controller, transformAlgorithm, flushAlgorithm);
    const startResult = startAlgorithm();
    resolvePromise(startPromise, startResult);
    return stream;
  }

  function InitializeTransformStream(
      stream, startPromise, writableHighWaterMark, writableSizeAlgorithm,
      readableHighWaterMark, readableSizeAlgorithm) {
    const startAlgorithm = () => startPromise;
    const writeAlgorithm = chunk =>
        TransformStreamDefaultSinkWriteAlgorithm(stream, chunk);
    const abortAlgorithm = reason =>
        TransformStreamDefaultSinkAbortAlgorithm(stream, reason);
    const closeAlgorithm = () =>
          TransformStreamDefaultSinkCloseAlgorithm(stream);
    stream[_writable] = binding.CreateWritableStream(
        startAlgorithm, writeAlgorithm, closeAlgorithm, abortAlgorithm,
        writableHighWaterMark, writableSizeAlgorithm);
    const pullAlgorithm = () =>
          TransformStreamDefaultSourcePullAlgorithm(stream);
    const cancelAlgorithm = reason => {
      TransformStreamErrorWritableAndUnblockWrite(stream, reason);
      return createResolvedPromise(undefined);
    };
    stream[_readable] = binding.CreateReadableStream(
        startAlgorithm, pullAlgorithm, cancelAlgorithm, readableHighWaterMark,
        readableSizeAlgorithm, false);
    stream[_backpressure] = undefined;
    stream[_backpressureChangePromise] = undefined;
    TransformStreamSetBackpressure(stream, true);
    stream[_transformStreamController] = undefined;
  }

  function IsTransformStream(x) {
    return hasOwnPropertyNoThrow(x, _transformStreamController);
  }

  function TransformStreamError(stream, e) {
    const readable = stream[_readable];
    // TODO(ricea): Remove this conditional once ReadableStream is updated.
    if (binding.IsReadableStreamReadable(readable)) {
      binding.ReadableStreamDefaultControllerError(
          binding.getReadableStreamController(readable), e);
    }

    TransformStreamErrorWritableAndUnblockWrite(stream, e);
  }

  function TransformStreamErrorWritableAndUnblockWrite(stream, e) {
    TransformStreamDefaultControllerClearAlgorithms(
        stream[_transformStreamController]);
    binding.WritableStreamDefaultControllerErrorIfNeeded(
        binding.getWritableStreamController(stream[_writable]), e);

    if (stream[_backpressure]) {
      TransformStreamSetBackpressure(stream, false);
    }
  }

  function TransformStreamSetBackpressure(stream, backpressure) {
    // assert(
    //     stream[_backpressure] !== backpressure,
    //     'stream.[[backpressure]] is not backpressure');

    if (stream[_backpressureChangePromise] !== undefined) {
      resolvePromise(stream[_backpressureChangePromise], undefined);
    }

    stream[_backpressureChangePromise] = createPromise();
    stream[_backpressure] = backpressure;
  }

  class TransformStreamDefaultController {
    constructor() {
      throw new TypeError(streamErrors.illegalConstructor);
    }

    get desiredSize() {
      if (!IsTransformStreamDefaultController(this)) {
        throw new TypeError(streamErrors.illegalInvocation);
      }

      const readableController = binding.getReadableStreamController(
          this[_controlledTransformStream][_readable]);
      return binding.ReadableStreamDefaultControllerGetDesiredSize(
          readableController);
    }

    enqueue(chunk) {
      if (!IsTransformStreamDefaultController(this)) {
        throw new TypeError(streamErrors.illegalInvocation);
      }

      TransformStreamDefaultControllerEnqueue(this, chunk);
    }

    error(reason) {
      if (!IsTransformStreamDefaultController(this)) {
        throw new TypeError(streamErrors.illegalInvocation);
      }

      TransformStreamDefaultControllerError(this, reason);
    }

    terminate() {
      if (!IsTransformStreamDefaultController(this)) {
        throw new TypeError(streamErrors.illegalInvocation);
      }

      TransformStreamDefaultControllerTerminate(this);
    }
  }

  const TransformStreamDefaultController_prototype =
      TransformStreamDefaultController.prototype;

  function IsTransformStreamDefaultController(x) {
    return hasOwnPropertyNoThrow(x, _controlledTransformStream);
  }

  function SetUpTransformStreamDefaultController(
      stream, controller, transformAlgorithm, flushAlgorithm) {
    // assert(
    //     IsTransformStream(stream) === true,
    //     '! IsTransformStream(_stream_) is *true*');
    // assert(
    //     stream[_transformStreamController] === undefined,
    //     '_stream_.[[transformStreamController]] is *undefined*');
    controller[_controlledTransformStream] = stream;
    stream[_transformStreamController] = controller;
    controller[_transformAlgorithm] = transformAlgorithm;
    controller[_flushAlgorithm] = flushAlgorithm;
  }

  function SetUpTransformStreamDefaultControllerFromTransformer(
      stream, transformer) {
    // assert(transformer !== undefined, '_transformer_ is not *undefined*');
    const controller = ObjectCreate(TransformStreamDefaultController_prototype);
    let transformAlgorithm;
    const transformMethod = transformer.transform;
    if (transformMethod !== undefined) {
      if (typeof transformMethod !== 'function') {
        throw new TypeError('transformer.transform is not a function');
      }
      transformAlgorithm = chunk =>
          PromiseCall2(transformMethod, transformer, chunk, controller);
    } else {
      transformAlgorithm = chunk => {
        try {
          TransformStreamDefaultControllerEnqueue(controller, chunk);
          return createResolvedPromise();
        } catch (resultValue) {
          return createRejectedPromise(resultValue);
        }
      };
    }
    const flushAlgorithm = CreateAlgorithmFromUnderlyingMethod(
        transformer, 'flush', 1, 'transformer.flush');
    SetUpTransformStreamDefaultController(
        stream, controller, transformAlgorithm, flushAlgorithm);
  }

  function TransformStreamDefaultControllerClearAlgorithms(controller) {
    controller[_transformAlgorithm] = undefined;
    controller[_flushAlgorithm] = undefined;
  }

  function TransformStreamDefaultControllerEnqueue(controller, chunk) {
    const stream = controller[_controlledTransformStream];
    const readableController =
        binding.getReadableStreamController(stream[_readable]);

    if (!binding.ReadableStreamDefaultControllerCanCloseOrEnqueue(
            readableController)) {
      throw binding.getReadableStreamEnqueueError(stream[_readable]);
    }

    try {
      binding.ReadableStreamDefaultControllerEnqueue(readableController, chunk);
    } catch (e) {
      TransformStreamErrorWritableAndUnblockWrite(stream, e);
      throw binding.getReadableStreamStoredError(stream[_readable]);
    }

    const backpressure = binding.ReadableStreamDefaultControllerHasBackpressure(
        readableController);
    if (backpressure !== stream[_backpressure]) {
      // assert(backpressure, 'backpressure is true');
      TransformStreamSetBackpressure(stream, true);
    }
  }

  function TransformStreamDefaultControllerError(controller, e) {
    TransformStreamError(controller[_controlledTransformStream], e);
  }

  function TransformStreamDefaultControllerPerformTransform(controller, chunk) {
    const transformPromise = controller[_transformAlgorithm](chunk, controller);
    return thenPromise(transformPromise, undefined, r => {
      TransformStreamError(controller[_controlledTransformStream], r);
      throw r;
    });
  }

  function TransformStreamDefaultControllerTerminate(controller) {
    const stream = controller[_controlledTransformStream];
    const readableController =
        binding.getReadableStreamController(stream[_readable]);

    if (binding.ReadableStreamDefaultControllerCanCloseOrEnqueue(
            readableController)) {
      binding.ReadableStreamDefaultControllerClose(readableController);
    }

    const error = new TypeError(errStreamTerminated);
    TransformStreamErrorWritableAndUnblockWrite(stream, error);
  }

  function TransformStreamDefaultSinkWriteAlgorithm(stream, chunk) {
    // assert(
    //     binding.isWritableStreamWritable(stream[_writable]),
    //     `stream.[[writable]][[state]] is "writable"`);

    const controller = stream[_transformStreamController];

    if (stream[_backpressure]) {
      const backpressureChangePromise = stream[_backpressureChangePromise];
      // assert(
      //     backpressureChangePromise !== undefined,
      //     `backpressureChangePromise is not undefined`);

      return thenPromise(backpressureChangePromise, () => {
        const writable = stream[_writable];
        if (binding.isWritableStreamErroring(writable)) {
          throw binding.getWritableStreamStoredError(writable);
        }
        // assert(binding.isWritableStreamWritable(writable),
        //        `state is "writable"`);

        return TransformStreamDefaultControllerPerformTransform(controller,
                                                                chunk);
      });
    }

    return TransformStreamDefaultControllerPerformTransform(controller, chunk);
  }

  function TransformStreamDefaultSinkAbortAlgorithm(stream, reason) {
    TransformStreamError(stream, reason);
    return createResolvedPromise();
  }

  function TransformStreamDefaultSinkCloseAlgorithm(stream) {
    const readable = stream[_readable];
    const controller = stream[_transformStreamController];
    const flushPromise = controller[_flushAlgorithm](controller);
    TransformStreamDefaultControllerClearAlgorithms(controller);

    return thenPromise(
        flushPromise,
        () => {
          if (binding.IsReadableStreamErrored(readable)) {
            throw binding.getReadableStreamStoredError(readable);
          }

          const readableController =
              binding.getReadableStreamController(readable);
          if (binding.ReadableStreamDefaultControllerCanCloseOrEnqueue(
                  readableController)) {
            binding.ReadableStreamDefaultControllerClose(readableController);
          }
        },
        r => {
          TransformStreamError(stream, r);
          throw binding.getReadableStreamStoredError(readable);
        });
  }

  function TransformStreamDefaultSourcePullAlgorithm(stream) {
    // assert(stream[_backpressure], 'stream.[[backpressure]] is true');
    // assert(
    //     stream[_backpressureChangePromise] !== undefined,
    //     'stream.[[backpressureChangePromise]] is not undefined');

    TransformStreamSetBackpressure(stream, false);
    return stream[_backpressureChangePromise];
  }

  // A wrapper for CreateTransformStream() with only the arguments that
  // blink::TransformStream needs. |transformAlgorithm| and |flushAlgorithm| are
  // passed the controller, unlike in the standard.
  function createTransformStreamSimple(transformAlgorithm, flushAlgorithm) {
    return CreateTransformStream(() => createResolvedPromise(),
                                 transformAlgorithm, flushAlgorithm);
  }
  function createTransformStream(
      transformer, writableStrategy, readableStrategy) {
    if (transformer === undefined) {
      transformer = ObjectCreate(null);
    }
    if (writableStrategy === undefined) {
      writableStrategy = ObjectCreate(null);
    }
    if (readableStrategy === undefined) {
      readableStrategy = ObjectCreate(null);
    }
    return new TransformStream(transformer, writableStrategy, readableStrategy);
  }

  function getTransformStreamReadable(stream) {
    return stream[_readable];
  }

  function getTransformStreamWritable(stream) {
    return stream[_writable];
  }

  //
  // Exports to Blink
  //
  Object.assign(binding, {
    createTransformStreamSimple,
    createTransformStream,
    TransformStreamDefaultControllerEnqueue,
    getTransformStreamReadable,
    getTransformStreamWritable
  });
});
